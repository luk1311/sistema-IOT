const fs = require('fs');
const Jimp = require('jimp');
const pngToIco = require('png-to-ico').default;

async function processIcon() {
  try {
    const inputPath = 'C:\\Users\\USUARIO\\.gemini\\antigravity-ide\\brain\\985491b2-30d5-4671-bdbf-ee6508818af6\\tadashy_favicon_brain_neon_1781216212234.png';
    const image = await Jimp.read(inputPath);
    
    image.resize(256, 256);
    
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
      const red   = this.bitmap.data[idx + 0];
      const green = this.bitmap.data[idx + 1];
      const blue  = this.bitmap.data[idx + 2];

      if (red < 35 && green < 35 && blue < 35) {
        this.bitmap.data[idx + 3] = 0;
      } else if (red < 60 && green < 60 && blue < 60) {
        this.bitmap.data[idx + 3] = Math.max(0, (red+green+blue) * 1.5);
      }
    });

    const tempPng = 'temp_favicon.png';
    await image.writeAsync(tempPng);
    
    const buf = await pngToIco(tempPng);
    fs.writeFileSync('favicon.ico', buf);
    
    fs.unlinkSync(tempPng);
    if (fs.existsSync('favicon.png')) {
      fs.unlinkSync('favicon.png');
    }
    
    console.log('Successfully created favicon.ico with transparent background');
  } catch (err) {
    console.error('Error:', err);
  }
}
processIcon();
