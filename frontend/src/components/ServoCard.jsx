import React, { useState, useEffect } from 'react';
import { useMqtt } from '../context/MqttContext';

export default function ServoCard({ index, name, iconKey }) {
  const { publish, deviceCache } = useMqtt();
  
  // En vez de tener un slider manual desconectado, intentamos sincronizarlo con feedback
  const feedbackTopic = `brazo/servo/feedback/${index}`;
  const [angle, setAngle] = useState(90);

  useEffect(() => {
    const feedback = deviceCache[feedbackTopic];
    if (feedback !== undefined) {
      setAngle(parseInt(feedback, 10) || 0);
    }
  }, [deviceCache, feedbackTopic]);

  const arcLen = Math.PI * 58;
  const strokeOffset = (arcLen - (angle / 180) * arcLen).toFixed(1);
  const needleTransform = `rotate(${-90 + angle} 70 70)`;

  const handleChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setAngle(val);
    publish(`brazo/servo/${index}`, val);
  };

  const handlePreset = (val) => {
    setAngle(val);
    publish(`brazo/servo/${index}`, val);
  };

  return (
    <div className="servo-card" id={`card${index}`}>
      <div className="servo-header">
        <div className="servo-title"><i className={`ti ${iconKey}`}></i>Servo {index} · {name}</div>
        <div className="servo-angle"><span className="num">{angle}</span><span className="deg">°</span></div>
      </div>
      <div className="arc-wrap">
        <svg width="140" height="82" viewBox="0 0 140 82" role="img" aria-label={`Ángulo servo ${index}`}>
          <path className="arc-bg-s" d="M 12,70 A 58,58 0 0,1 128,70"/>
          <path className="arc-fill-s" d="M 12,70 A 58,58 0 0,1 128,70" strokeDasharray={arcLen.toFixed(1)} strokeDashoffset={strokeOffset}/>
          <line x1="70" y1="70" x2="70" y2="16" stroke="#a78bff" strokeWidth="2" strokeLinecap="round" className="needle-s" transform={needleTransform} style={{ transformOrigin: '70px 70px' }}/>
          <circle cx="70" cy="70" r="4" fill="#7c6aff"/>
          <text x="10" y="80" fontSize="9" fill="#4a3f6b">0°</text>
          <text x="62" y="12" fontSize="9" fill="#4a3f6b">90°</text>
          <text x="118" y="80" fontSize="9" fill="#4a3f6b" textAnchor="end">180°</text>
        </svg>
      </div>
      <input type="range" min="0" max="180" value={angle} step="1" onChange={handleChange} />
      <div className="slider-ticks"><span>0°</span><span>90°</span><span>180°</span></div>
      <div className="presets">
        {[0, 45, 90, 135, 180].map(val => (
          <button key={val} className="preset" onClick={() => handlePreset(val)}>{val}°</button>
        ))}
      </div>
    </div>
  );
}
