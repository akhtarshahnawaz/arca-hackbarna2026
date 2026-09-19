# Data sources — original websites

ARCA ranks people and animals inside a fire shape. The lists below are the **public websites** for the datasets we actually use (not the JSON API endpoints). Import notes live in `data/official/README.md`.

Portal: [Dades obertes de Catalunya](https://analisi.transparenciacatalunya.cat)  
Licence: [Llicència oberta d’informació de Catalunya](https://administraciodigital.gencat.cat/ca/dades/dades-obertes/informacio-practica/llicencies/)

## Official facilities (`npm run data:refresh`)

| What ARCA uses | Dataset | Publisher | Original website |
|---|---|---|---|
| Schools (directory, address, coordinates) | Directori de centres docents anual. Base 2020 (`kvmv-ahh4`) | Departament d'Educació i Formació Professional | https://analisi.transparenciacatalunya.cat/d/kvmv-ahh4 |
| School capacity (enrolments, not occupancy) | Alumnes matriculats per ensenyament i unitats dels centres docents (`xvme-26kg`) | Departament d'Educació i Formació Professional | https://analisi.transparenciacatalunya.cat/d/xvme-26kg |
| Care homes (RESES residential services for older people) | Registre d’entitats, serveis i establiments socials (`ivft-vegh`) | Departament de Drets Socials i Inclusió | https://analisi.transparenciacatalunya.cat/d/ivft-vegh |
| Hospitals and CAPs | Equipaments de Catalunya (`8gmd-gz7i`) | Direcció General de Serveis Digitals i Experiència Ciutadana | https://analisi.transparenciacatalunya.cat/d/8gmd-gz7i |
| Municipality reference points (fallback location) | Caps de municipi de Catalunya georeferenciats (`wpyq-we8x`) | Institut Cartogràfic i Geològic de Catalunya (ICGC) | https://analisi.transparenciacatalunya.cat/d/wpyq-we8x |
| Hospital bed counts (unique name match only) | Catálogo Nacional de Hospitales 2025 | Ministerio de Sanidad | https://www.sanidad.gob.es/estadEstudios/estadisticas/sisInfSanSNS/ofertaRecursos/hospitales/home.htm |
| Care-home address geocoding | CartoCiudad | Instituto Geográfico Nacional (IGN) | https://www.cartociudad.es |

ICGC source note on municipality points: https://www.icgc.cat/ca/Descarregues/Cartografia-vectorial/Divisions-administratives

## Livestock

| What ARCA uses | Dataset | Publisher | Original website |
|---|---|---|---|
| Extra Bages farms (capacity ≠ animals present) | Registre d'explotacions ramaderes (`7bpt-5azk`) | Departament d'Agricultura, Ramaderia, Pesca i Alimentació | https://analisi.transparenciacatalunya.cat/d/7bpt-5azk |

## Fire

| What ARCA uses | Source | Original website |
|---|---|---|
| Live Catalonia hotspots | Deepfire | https://deepfire.co |

Hour rings on the coordinator map are a labelled DEMO ensemble. They are not attached Deepfire spread polygons.

## Other layers in the demo

| What ARCA uses | Original website | Note |
|---|---|---|
| OpenStreetMap | https://www.openstreetmap.org | Leftover care-home seed only. Not fetched live. Not the pet-evac list. |
| Map tiles (Esri) | https://www.arcgis.com | Light gray base + world imagery on the command map. |
| Pet shelters | (none — local file) | `config/shelters.json`, configured by the coordinator. |

Residents come from Telegram opt-in, not an open dataset.
