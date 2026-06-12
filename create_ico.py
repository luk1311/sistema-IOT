from PIL import Image
import math

img = Image.open('favicon.png').convert("RGBA")
datas = img.getdata()

newData = []
# Color del fondo #0d1117 -> RGB(13, 17, 23)
# Color del logo #a855f7 -> RGB(168, 85, 247)
for item in datas:
    r, g, b, a = item
    dist = math.sqrt((r-13)**2 + (g-17)**2 + (b-23)**2)
    
    if dist < 30:
        newData.append((255, 255, 255, 0))
    else:
        # Hacemos los bordes semi-transparentes para que quede suave
        if dist < 120:
            alpha = int(((dist - 30) / 90) * 255)
            newData.append((168, 85, 247, alpha))
        else:
            newData.append((168, 85, 247, 255))

img.putdata(newData)
# Redimensionamos para que sea un ícono cuadrado
img.thumbnail((256, 256), Image.Resampling.LANCZOS)
# Guardamos como ICO real
img.save("favicon.ico", format="ICO", sizes=[(64, 64), (128, 128), (256, 256)])
print("Favicon generado con éxito")
