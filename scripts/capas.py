"""Genera las capas del globo en public/capas/ a partir de los límites de prep/vuelo/limites.

Salida: GeoJSON simplificado (Douglas-Peucker) con coordenadas a 5 decimales.
Uso: python scripts/capas.py
"""
import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
LIMITES = RAIZ.parent / 'prep' / 'vuelo' / 'limites'
SALIDA = RAIZ / 'public' / 'capas'


def dp(puntos, tol):
    """Douglas-Peucker iterativo sobre [lon, lat]."""
    if len(puntos) < 3:
        return puntos
    keep = [False] * len(puntos)
    keep[0] = keep[-1] = True
    pila = [(0, len(puntos) - 1)]
    while pila:
        a, b = pila.pop()
        ax, ay = puntos[a]
        bx, by = puntos[b]
        dx, dy = bx - ax, by - ay
        norma = (dx * dx + dy * dy) or 1e-18
        peor, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = puntos[i]
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / norma))
            ex, ey = ax + t * dx - px, ay + t * dy - py
            d = ex * ex + ey * ey
            if d > peor:
                peor, idx = d, i
        if idx >= 0 and peor > tol * tol:
            keep[idx] = True
            pila += [(a, idx), (idx, b)]
    return [p for p, k in zip(puntos, keep) if k]


def anillo(coords, tol):
    pts = dp([[round(x, 5), round(y, 5)] for x, y, *_ in coords], tol)
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    return pts


def feature(nombre, anillos):
    return {
        'type': 'Feature',
        'properties': {'nombre': nombre},
        'geometry': {'type': 'MultiPolygon', 'coordinates': [[r] for r in anillos]},
    }


def guardar(nombre, feat):
    SALIDA.mkdir(parents=True, exist_ok=True)
    ruta = SALIDA / f'{nombre}.geojson'
    ruta.write_text(json.dumps({'type': 'FeatureCollection', 'features': [feat]}, separators=(',', ':')), encoding='utf-8')
    n = sum(len(p[0]) for p in feat['geometry']['coordinates'])
    print(f'{ruta.name}: {n} puntos, {ruta.stat().st_size // 1024} KB')


def kml_poligono(kml, nombre):
    for bloque in re.findall(r'<Placemark>(.*?)</Placemark>', kml, re.S):
        if f'<name>{nombre}</name>' in bloque and '<Polygon>' in bloque:
            texto = re.search(r'<coordinates>(.*?)</coordinates>', bloque, re.S).group(1)
            return [[float(v) for v in t.split(',')] for t in texto.split()]
    raise SystemExit(f'No se encontró {nombre} en el KML')


def main():
    pais = json.loads((LIMITES / 'col_ADM0.geojson').read_text(encoding='utf-8'))['features'][0]
    geo = pais['geometry']
    rings = [geo['coordinates'][0]] if geo['type'] == 'Polygon' else [p[0] for p in geo['coordinates']]
    guardar('colombia', feature('Colombia', [anillo(r, 0.02) for r in rings]))

    deptos = json.loads((LIMITES / 'col_ADM1.geojson').read_text(encoding='utf-8'))['features']
    ant = next(f for f in deptos if f['properties']['shapeName'] == 'Antioquia')
    rings = [p[0] for p in ant['geometry']['coordinates'] if len(p[0]) > 50]
    guardar('antioquia', feature('Antioquia', [anillo(r, 0.004) for r in rings]))

    kml = (LIMITES / 'verdelote_limites_pais.kml').read_text(encoding='utf-8', errors='replace')
    guardar('girardota', feature('Girardota', [anillo(kml_poligono(kml, 'Girardota'), 0.0005)]))


if __name__ == '__main__':
    main()
