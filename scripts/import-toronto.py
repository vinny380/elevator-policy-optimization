"""Refresh the bundled OSM-derived Toronto extract; no runtime map service or API key.
Usage: python3 scripts/import-toronto.py [downloaded-map.osm]
Source database: OpenStreetMap contributors, ODbL 1.0. See public/toronto/README.md.
"""
import datetime, json, math, pathlib, sys, urllib.request, xml.etree.ElementTree as ET
BBOX = [-79.3985, 43.6380, -79.3825, 43.6495]
ORIGIN = [-79.39237, 43.64528]
if len(sys.argv) > 1:
    raw = pathlib.Path(sys.argv[1]).read_bytes()
else:
    url = 'https://api.openstreetmap.org/api/0.6/map?bbox=' + ','.join(map(str, BBOX))
    raw = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'ElevatorPolicyOptimization/1.0'}), timeout=60).read()
root = ET.fromstring(raw)
nodes = {n.get('id'): [float(n.get('lon')), float(n.get('lat'))] for n in root.findall('node')}
def local(p):
    return [round((p[0]-ORIGIN[0])*111320*math.cos(math.radians(ORIGIN[1])), 2), round((ORIGIN[1]-p[1])*111320, 2)]
def inside(p): return BBOX[0] <= p[0] <= BBOX[2] and BBOX[1] <= p[1] <= BBOX[3]
def number(value):
    try: return float(str(value).split()[0])
    except ValueError: return None
buildings, streets, rails, parks, trees = [], [], [], [], []
for way in root.findall('way'):
    tags = {t.get('k'): t.get('v') for t in way.findall('tag')}
    points = [nodes[n.get('ref')] for n in way.findall('nd') if n.get('ref') in nodes]
    if len(points) < 2: continue
    centre = [sum(p[i] for p in points)/len(points) for i in range(2)]
    if ('building' in tags or tags.get('building:part') not in [None, 'no']) and inside(centre) and points[0] == points[-1]:
        explicit = number(tags.get('height')); levels = number(tags.get('building:levels'))
        buildings.append({'id': int(way.get('id')), 'name': tags.get('name',''), 'points': list(map(local,points[:-1])),
            'height': explicit or (levels*3.3 if levels else 12), 'heightSource': 'tag' if explicit else 'levels' if levels else 'estimated',
            'base': number(tags.get('min_height')) or (number(tags.get('building:min_level')) or 0)*3.3,
            'part': tags.get('building:part') not in [None, 'no'], 'material': tags.get('building:material','')})
    kind = tags.get('highway')
    if kind and kind not in ['proposed','construction','steps','elevator'] or tags.get('railway') in ['rail','tram']:
        segments = []
        for p in points:
            if inside(p): segments.append(local(p))
            elif len(segments)>1:
                (streets if kind else rails).append({'name':tags.get('name',''), 'kind':kind or tags['railway'], 'points':segments});segments=[]
            else: segments=[]
        if len(segments)>1: (streets if kind else rails).append({'name':tags.get('name',''), 'kind':kind or tags['railway'], 'points':segments})
    if tags.get('leisure') in ['park','garden'] and inside(centre) and points[0]==points[-1]: parks.append({'name':tags.get('name',''), 'points':list(map(local,points[:-1]))})
for n in root.findall('node'):
    if any(t.get('k')=='natural' and t.get('v')=='tree' for t in n.findall('tag')) and inside(nodes[n.get('id')]): trees.append(local(nodes[n.get('id')]))
assert any(b['id']==416989000 for b in buildings) and any(b['id']==32742038 for b in buildings) and any(b['id']==7969701 for b in buildings)
assert len(streets)>100 and len(buildings)>100
out={'source':'OpenStreetMap contributors','license':'ODbL-1.0','downloaded':datetime.date.today().isoformat(),'origin':ORIGIN,'bbox':BBOX,'buildings':buildings,'streets':streets,'rails':rails,'parks':parks,'trees':trees}
dest=pathlib.Path('public/toronto');dest.mkdir(parents=True,exist_ok=True)
(dest/'district.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
print({k:len(out[k])for k in ['buildings','streets','rails','parks','trees']}, (dest/'district.json').stat().st_size,'bytes')
