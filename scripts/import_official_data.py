#!/usr/bin/env python3
"""Refresh ARCA official facilities. Python standard library only; no OSM merging."""
import argparse
import collections
import datetime
import io
import json
import pathlib
import re
import time
import ssl
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

BASE = 'https://analisi.transparenciacatalunya.cat/resource/'
CNH = 'https://www.sanidad.gob.es/estadEstudios/estadisticas/sisInfSanSNS/ofertaRecursos/hospitales/docs/CNH_2025.xlsx'
GEOCODER = 'https://www.cartociudad.es/geocoder/api/geocoder/'


def download(url):
    for attempt in range(3):
        try:
            context = ssl.create_default_context()
            # python.org macOS installs may lack their bundled CA symlink.
            system_ca = pathlib.Path('/etc/ssl/cert.pem')
            if system_ca.exists():
                context.load_verify_locations(cafile=str(system_ca))
            with urllib.request.urlopen(url, timeout=35, context=context) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def soda(dataset, **params):
    rows = []
    for offset in range(0, 1000000, 5000):
        query = {'$limit': 5000, '$offset': offset, '$order': ':id', **params}
        page = json.loads(download(BASE + dataset + '.json?' + urllib.parse.urlencode(query)))
        if not isinstance(page, list):
            raise ValueError('Unexpected SODA response: ' + dataset)
        rows.extend(page)
        if len(page) < 5000:
            return rows
    raise ValueError('Pagination limit exceeded')


def norm(value):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode().lower())


def number(value):
    try:
        n = float(str(value).replace(',', '.'))
        return int(n) if n >= 0 and n.is_integer() else None
    except (ValueError, TypeError):
        return None


def coordinates(lon, lat):
    try:
        lon, lat = float(lon), float(lat)
        return (lon, lat) if 0 <= lon <= 3.5 and 40.4 <= lat <= 43 else None
    except (ValueError, TypeError):
        return None


def enrolments(rows):
    """Sum total enrolments only, never total + sex subtotals or multiple years."""
    groups = collections.defaultdict(list)
    for r in rows:
        groups[(r['codi_centre'], r['curs'])].append(number(r.get('matr_cules_total')))
    return {key: sum(values) if all(v is not None for v in values) else None
            for key, values in groups.items()}


def hospital_rows(content):
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        strings = [''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        table = []
        for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//m:row', ns):
            cells = {}
            for c in row:
                value = c.findtext('m:v', '', ns)
                cells[re.sub(r'\d', '', c.attrib['r'])] = strings[int(value)] if c.get('t') == 's' else value
            table.append(cells)
    headers = table[0]
    if not {'CCN', 'CAMAS', 'Nombre Centro', 'Municipio'}.issubset(set(headers.values())):
        raise ValueError('CNH workbook schema changed')
    return [{headers[k]: v for k, v in row.items() if k in headers} for row in table[1:]]


def hospital_name(value, municipality):
    tokens = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()
    ignored = {'de', 'del', 'la', 'el', 'l', 'd'} | set(re.findall(r'[a-z0-9]+', municipality.lower()))
    return ''.join(t for t in re.findall(r'[a-z0-9]+', tokens) if t not in ignored)


def match_hospital(site, hospitals):
    # An exact normalized name + municipality must uniquely identify a centre.
    matches = [h for h in hospitals if hospital_name(h.get('Nombre Centro', ''), site['municipality']) == hospital_name(site['name'], site['municipality'])
               and norm(h.get('Municipio')) == norm(site['municipality']) and h.get('CCN')]
    return matches[0] if len(matches) == 1 else None


def geocode(address, postcode, municipality, cache):
    query = f'{address}, {postcode} {municipality}'
    if cache.get(query):
        return cache[query]
    candidates = json.loads(download(GEOCODER + 'candidates?' + urllib.parse.urlencode({'q': query, 'limit': 50})))
    requested = re.findall(r'\b\d+\b', address)
    wanted = int(requested[0]) if len(requested) == 1 else None
    valid = [c for c in candidates if c.get('type') == 'portal'
             and norm(c.get('muni')) == norm(municipality)
             and str(c.get('postalCode', '')).zfill(5) == str(postcode).zfill(5)
             and wanted is not None and number(c.get('portalNumber')) == wanted]
    if len(valid) != 1:
        cache[query] = None
        return None
    candidate = valid[0]
    result = json.loads(download(GEOCODER + 'find?' + urllib.parse.urlencode({'id': candidate['id'], 'type': candidate['type']})))
    point = coordinates(result.get('lng'), result.get('lat'))
    cache[query] = list(point) if point else None
    time.sleep(0.1)
    return cache[query]


def site_record(dataset, key, kind, name, municipality, point, capacity=None, unit=None, period=None, phone=None, email=None, quality='official_point', address=''):
    return dict(id=f'{dataset}-{key}', code=f'{dataset.upper()}-{key}', kind=kind,
                name=name, municipality=municipality, lon=point[0], lat=point[1],
                animals=[], hasOwnTransport=None, confirmedAt=None, capacityUpdatedAt=None,
                source='registry', shelterHint='Coordinator must confirm a suitable destination.',
                notes=f'{name}. {capacity if capacity is not None else "Unknown"} {unit or "capacity"}; not current occupancy. Location: {quality}.',
                phone=phone, email=email, address=address,
                facilityCapacity=capacity, capacityUnit=unit, capacityPeriod=period,
                locationQuality=quality, datasetId=dataset, sourceRecordId=key,
                sourceUrl=BASE+dataset+'.json', attribution='Generalitat de Catalunya — Llicència oberta d’informació de Catalunya')


def run(args):
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    cache_path = output.parent / 'geocoding-cache.json'
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    comarca = args.comarca.replace("'", "''")
    scope = lambda field: {} if args.all_catalonia else {'$where': f"{field} = '{comarca}'"}
    print('Fetching official datasets...', flush=True)
    schools = soda('kvmv-ahh4', **scope('nom_comarca'))
    students = soda('xvme-26kg', **scope('nom_comarca'))
    social = soda('ivft-vegh', **scope('comarca'))
    equipment = soda('8gmd-gz7i', **{'$where': "categoria like '%Hospitals%' OR categoria like '%CAP)%'"})
    municipalities = soda('wpyq-we8x', **scope('comarca'))
    municipality_codes = {str(r['codi_municipi']).zfill(6): r['municipi'] for r in municipalities}
    if not args.all_catalonia:
        equipment = [r for r in equipment if str(r.get('codi_municipi', '')).zfill(6) in municipality_codes]
    # Latest complete school directory period; never mix historical school rows.
    period = max((r.get('curs', '') for r in schools), default='')
    counts = enrolments([r for r in students if r.get('curs') == period])
    sites, unlocated, review, seen = [], [], [], set()
    for r in schools:
        key = r.get('codi_centre')
        if r.get('curs') != period or not key or key in seen:
            continue
        seen.add(key)
        point = coordinates(r.get('coordenades_geo_x'), r.get('coordenades_geo_y'))
        if not point:
            unlocated.append({'datasetId': 'kvmv-ahh4', 'id': key, 'reason': 'Invalid/missing coordinates'})
            continue
        s = site_record('kvmv-ahh4', key, 'school', r['denominaci_completa'], r['nom_municipi'], point,
                        counts.get((key, period)), 'students', period, r.get('tel_fon'), r.get('e_mail_centre'), address=r.get('adre_a', ''))
        s['capacitySourceUrl'] = BASE + 'xvme-26kg.json'
        sites.append(s)
    centroids = {}
    for r in municipalities:
        for field in ['municipi', 'municipi_forma_indexada']:
            centroids[norm(r.get(field))] = coordinates(r.get('longitud'), r.get('latitud'))
    geocode_errors = []
    for r in social:
        typology = norm(r.get('tipologia', ''))
        if not ('residencia' in typology and 'gentgran' in typology):
            continue
        point = None
        if not args.skip_geocoding:
            try:
                point = geocode(r.get('adreca', ''), r.get('cp', ''), r.get('municipi', ''), cache)
            except Exception as e:
                geocode_errors.append({'id': r['registre'], 'error': str(e)})
        quality = 'address_geocoded' if point else 'municipality_centroid'
        point = point or centroids.get(norm(r.get('municipi')))
        if not point:
            unlocated.append({'datasetId': 'ivft-vegh', 'id': r['registre'], 'reason': 'Address and municipality unresolved'})
            continue
        s = site_record('ivft-vegh', r['registre'], 'care_home', r['nom'], r['municipi'], point,
                        number(r.get('capacitat')), 'places', None, r.get('telefon'), quality=quality, address=r.get('adreca', ''))
        if quality == 'address_geocoded':
            s['locationAttribution'] = 'IGN / CartoCiudad — CC BY 4.0'
        sites.append(s)
    hospital_error = None
    try:
        hospitals = hospital_rows(pathlib.Path(args.hospitals_xlsx).read_bytes() if args.hospitals_xlsx else download(CNH))
    except Exception as e:
        hospitals, hospital_error = [], str(e)
    used_ccn = set()
    for r in equipment:
        category = r.get('categoria', '')
        kind = 'hospital' if '|3. Hospitals|' in category else 'cap' if "|1. Centres d'atenció primària (CAP)|" in category else None
        if not kind:
            continue
        point = coordinates(r.get('longitud'), r.get('latitud'))
        if not point:
            unlocated.append({'datasetId': '8gmd-gz7i', 'id': r['idequipament'], 'reason': 'Invalid/missing coordinates'})
            continue
        s = site_record('8gmd-gz7i', r['idequipament'], kind, r['nom'], r.get('poblacio') or municipality_codes.get(str(r.get('codi_municipi', '')).zfill(6), 'Unknown municipality'), point, phone=r.get('telefon1'), email=r.get('email'))
        h = match_hospital(s, hospitals) if kind == 'hospital' else None
        if h and h['CCN'] not in used_ccn:
            used_ccn.add(h['CCN'])
            s.update(facilityCapacity=number(h.get('CAMAS')), capacityUnit='beds', capacityPeriod='CNH 2025',
                     ccn=h['CCN'], capacitySourceUrl=CNH, capacityAttribution='Ministerio de Sanidad — Catálogo Nacional de Hospitales 2025', phone=h.get('Teléfono'), email=h.get('Email'))
            s['notes'] = f"{s['name']}. {s['facilityCapacity']} installed beds (CNH 2025); not current occupancy."
        elif kind == 'hospital':
            review.append({'id': s['id'], 'name': s['name'], 'municipality': s['municipality'], 'reason': 'No unique unused normalized CNH match; capacity unknown'})
        sites.append(s)
    ids = [s['id'] for s in sites]
    if len(ids) != len(set(ids)) or not sites:
        raise ValueError('Duplicate IDs or empty import; previous snapshot preserved')
    report = dict(schemaVersion=1, fetchedAt=now, scope='Catalonia' if args.all_catalonia else args.comarca,
                  academicYear=period, sites=sites, unlocated=unlocated, hospitalMatchReview=review,
                  geocodingErrors=geocode_errors, hospitalError=hospital_error,
                  counts=dict(collections.Counter(s['kind'] for s in sites)),
                  approximateLocations=sum(s['locationQuality'] == 'municipality_centroid' for s in sites),
                  sources=[{'id': i, 'url': BASE+i+'.json'} for i in ['kvmv-ahh4','xvme-26kg','ivft-vegh','8gmd-gz7i','wpyq-we8x']])
    temp = output.with_suffix('.tmp')
    temp.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    temp.replace(output)
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ['sites','sources']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--comarca', default='Bages')
    p.add_argument('--all-catalonia', action='store_true')
    p.add_argument('--output', default='data/official/facilities.json')
    p.add_argument('--hospitals-xlsx', help='Optional local CNH 2025 workbook')
    p.add_argument('--skip-geocoding', action='store_true', help='Mark care homes as approximate municipality points')
    run(p.parse_args())
