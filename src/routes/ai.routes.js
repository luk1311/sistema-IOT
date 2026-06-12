module.exports = function(deps) {
  const { readDb, writeDb, requireAuth, addHistory, checkRateLimit, sessionManager, getAiService, crypto, getIotStore, executeBackendToolCall, PERMISSIONS } = deps;
  const express = require('express');
  const router = express.Router();

  router.get('/capabilities', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'ai_chat');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    return res.status(200).json({
      model: getAiService()?.model || '',
      ollamaUrl: getAiService()?.ollamaUrl || '',
      tools: getAiService()?.toolRegistry?.list() || []
    });
  });

  router.get('/history', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'ai_chat');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const sessionId = req.query.sessionId || 'default';
    const history = getAiService().listHistory(allowed.user.id, sessionId);
    return res.status(200).json({ history });
  });

  router.get('/memory', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'memory:read');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const sessionId = req.query.sessionId || 'default';
    return res.status(200).json({ memory: getIotStore().getMemoryProfile(allowed.user.id, sessionId) });
  });

  router.patch('/memory', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'memory:write');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });
    const sessionId = req.body.sessionId || 'default';
    const memory = getIotStore().upsertMemoryProfile(allowed.user.id, sessionId, req.body.memory || {});
    addHistory(db, allowed.user, 'ai_memory', 'Actualizo memoria operacional', { sessionId });
    writeDb(db);
    return res.status(200).json({ memory });
  });

  router.post('/chat', async (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'ai_chat');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });

    if (!checkRateLimit(req, 15, 60000)) {
      return res.status(429).json({ error: 'Demasiadas solicitudes al chat de IA. Límite de 15 peticiones por minuto.' });
    }

    const correlationId = crypto.randomUUID();
    res.setHeader('X-Correlation-ID', correlationId);

    const body = req.body;
    if (!body.message) return res.status(400).json({ error: 'El mensaje es requerido.' });

    const sessionId = body.sessionId || 'default';
    const stream = body.stream === true;
    sessionManager.touch(allowed.user.id, sessionId, { channel: body.channel || 'text' });
    const aiService = getAiService();

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Correlation-ID': correlationId
      });

      res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

      try {
        const response = await aiService.chat({
          user: allowed.user,
          sessionId,
          message: body.message,
          model: body.model,
          stream: true,
          onChunk: (chunk) => {
            res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
          },
          correlationId
        });

        if (response.requiresConfirmation) {
          res.write(`event: confirmation\ndata: ${JSON.stringify({
            requiresConfirmation: true,
            confirmationToken: response.confirmationToken,
            action: response.action
          })}\n\n`);
        }

        res.write(`event: done\ndata: ${JSON.stringify({ history: response.history })}\n\n`);
        res.end();

        addHistory(db, allowed.user, 'ai_chat', `Chat IA (SSE stream): "${body.message.slice(0, 40)}..."`, { correlationId });
        writeDb(db);
      } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'Error en streaming' })}\n\n`);
        res.end();
      }
      return;
    } else {
      try {
        const response = await aiService.chat({
          user: allowed.user,
          sessionId,
          message: body.message,
          model: body.model,
          stream: false,
          correlationId
        });

        addHistory(db, allowed.user, 'ai_chat', `Chat IA: "${body.message.slice(0, 40)}..."`, { correlationId });
        writeDb(db);

        return res.status(200).json({ ...response, correlationId });
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message || 'Error en el servicio de IA' });
      }
    }
  });

  router.post('/confirm', (req, res) => {
    const db = readDb();
    const allowed = requireAuth(req, db, 'ai_chat');
    if (allowed.error) return res.status(allowed.status).json({ error: allowed.error });

    const body = req.body;
    if (!body.token) return res.status(400).json({ error: 'Token de confirmación requerido.' });
    
    const aiService = getAiService();

    const pending = aiService.pendingConfirmations.get(body.token);
    if (!pending) {
      return res.status(404).json({ error: 'Acción de confirmación expirada o inválida.' });
    }

    if (pending.userId !== allowed.user.id) {
      return res.status(403).json({ error: 'No estás autorizado para confirmar esta acción.' });
    }

    if (Array.isArray(pending.toolCalls) && pending.toolCalls.length > 1) {
      const results = pending.toolCalls.map((call) => executeBackendToolCall(db, allowed.user, call, pending.correlationId));
      const failed = results.find((item) => item.status === 'error');
      const batchStatus = failed ? 'error' : 'success';
      const batchResult = failed
        ? { results, error: failed.result.error }
        : { results, message: `${results.length} accion(es) ejecutada(s) por backend.` };

      aiService.pendingConfirmations.delete(body.token);
      aiService.addMessage(allowed.user.id, pending.sessionId || 'default', 'tool', JSON.stringify(batchResult), {
        tool_name: 'batch',
        username: allowed.user.username,
        correlationId: pending.correlationId
      }, aiService.model);

      const finalReply = batchStatus === 'success'
        ? `Confirmado. Ejecute ${pending.toolCalls.length} accion(es) con exito.`
        : `Error al ejecutar la accion: ${batchResult.error}`;
      aiService.addMessage(allowed.user.id, pending.sessionId || 'default', 'assistant', finalReply, {
        username: allowed.user.username,
        correlationId: pending.correlationId
      }, aiService.model);

      if (batchStatus === 'error') return res.status(500).json({ error: batchResult.error, result: batchResult });
      writeDb(db);
      return res.status(200).json({ success: true, message: finalReply, result: batchResult });
    }

    const startTime = Date.now();
    const resultData = executeBackendToolCall(db, allowed.user, { toolName: pending.toolName, args: pending.args }, pending.correlationId);
    
    aiService.pendingConfirmations.delete(body.token);

    aiService.addMessage(allowed.user.id, 'default', 'tool', JSON.stringify(resultData.result), {
      tool_name: pending.toolName,
      username: allowed.user.username,
      correlationId: pending.correlationId
    }, aiService.model);

    const finalReply = resultData.status === 'success' ? `Confirmado. He ejecutado la herramienta '${pending.toolName}' con éxito.` : `Error al ejecutar la acción: ${resultData.result.error}`;
    aiService.addMessage(allowed.user.id, 'default', 'assistant', finalReply, {
      username: allowed.user.username,
      correlationId: pending.correlationId
    }, aiService.model);

    if (resultData.status === 'error') {
      return res.status(500).json({ error: resultData.result.error });
    }

    return res.status(200).json({ success: true, message: finalReply, result: resultData.result });
  });

  return router;
};
