"""Separa el logo de AM Grupo Inmobiliario del fondo crema y genera las versiones del sitio.

Entrada: prep/marca/am-logo-original.jpg (logo del cliente sobre fondo crema)
Salida en src/assets/marca/:
  - am-logo-claro.png   logo completo para fondo oscuro (negro pasa a blanco cálido, dorado igual)
  - am-logo-oscuro.png  logo completo con sus colores, fondo transparente (fondos claros)
  - am-marca-claro.png  solo el monograma AM para la barra de navegación
  - am-marca-oscuro.png solo el monograma AM con sus colores
Cada píxel se separa como mezcla del fondo con el negro o con el dorado (el que mejor explique su color),
así los bordes suavizados quedan limpios sobre cualquier fondo.
Uso: python scripts/marca.py
"""
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ.parent / 'prep' / 'marca' / 'am-logo-original.jpg'
SALIDA = RAIZ / 'src' / 'assets' / 'marca'

FONDO = (249, 244, 238)
NEGRO = (42, 42, 40)
DORADO = (183, 143, 84)
BLANCO = (244, 245, 243)

# Recortes en píxeles del original (1254x1254): logo completo y monograma
LOGO = (215, 370, 1045, 885)
MARCA = (250, 375, 1010, 752)


def separar(px):
    """Devuelve (tinta, alfa): tinta 'negro' o 'dorado' y su opacidad 0..1"""
    mejor = None
    for nombre, c in (('negro', NEGRO), ('dorado', DORADO)):
        # alfa por mínimos cuadrados: px = a*c + (1-a)*fondo
        d = [c[i] - FONDO[i] for i in range(3)]
        p = [px[i] - FONDO[i] for i in range(3)]
        den = sum(x * x for x in d)
        a = max(0.0, min(1.0, sum(p[i] * d[i] for i in range(3)) / den))
        err = sum((p[i] - a * d[i]) ** 2 for i in range(3))
        if mejor is None or err < mejor[2]:
            mejor = (nombre, a, err)
    return mejor[0], mejor[1]


def generar(caja, colores, ruta):
    im = Image.open(ORIGEN).convert('RGB').crop(caja)
    out = Image.new('RGBA', im.size)
    src, dst = im.load(), out.load()
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            tinta, a = separar(src[x, y])
            # Ruido del JPG en el fondo: por debajo de 6 % se descarta
            a = 0 if a < 0.06 else min(1.0, (a - 0.06) / 0.88)
            dst[x, y] = (*colores[tinta], round(a * 255))
    out = out.crop(out.getbbox())
    out.save(ruta, optimize=True)
    print(f'{ruta.name}: {out.size[0]}x{out.size[1]}')


def main():
    SALIDA.mkdir(parents=True, exist_ok=True)
    claro = {'negro': BLANCO, 'dorado': DORADO}
    oscuro = {'negro': NEGRO, 'dorado': DORADO}
    generar(LOGO, claro, SALIDA / 'am-logo-claro.png')
    generar(LOGO, oscuro, SALIDA / 'am-logo-oscuro.png')
    generar(MARCA, claro, SALIDA / 'am-marca-claro.png')
    generar(MARCA, oscuro, SALIDA / 'am-marca-oscuro.png')


if __name__ == '__main__':
    main()
