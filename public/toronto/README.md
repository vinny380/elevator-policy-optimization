# Toronto geographic model

The scene covers 43.6380–43.6495° N, 79.3985–79.3825° W: the Entertainment District, Blue Jays Way, CN Tower, Rogers Centre, rail corridor and Roundhouse Park. Local coordinates are metres east/south of 79.39237° W, 43.64528° N. The renderer uses 0.2 scene units per metre.

## Map data and license

**© OpenStreetMap contributors** — https://www.openstreetmap.org/copyright

`district.json` is a derived OpenStreetMap database, distributed under the **Open Database License (ODbL) 1.0**: https://opendatacommons.org/licenses/odbl/1-0/ . It includes the geographic coordinates, retained OSM way IDs, footprint/road geometry, and height provenance. The downloadable JSON is the machine-readable derived database; its ODbL license is separate from the application code. Source: https://api.openstreetmap.org/api/0.6/map?bbox=-79.3985,43.6380,-79.3825,43.6495 . The download date is recorded inside the JSON.

Refresh with `python3 scripts/import-toronto.py`, or pass a saved OSM XML file as its first argument. Roads, railways, parks, trees and building footprints are mapped geometry. Parents containing building parts are omitted to avoid overlapping solid towers. Heights use an explicit OSM height where present, otherwise storeys × 3.3 metres, otherwise a clearly recorded 12-metre estimate. Road widths and facade/window patterns are illustrative. Geometry may reflect map omissions and construction changes.

## Landmark references

- **Bisha Hotel & Residences, 88 Blue Jays Way:** mapped outline (OSM 416989000) and tower/podium parts (944510172, 944510170). The developer identifies 44 storeys, glass/steel tower and retained brick facade: https://lifetimedevelopments.com/project/bisha-hotel/ . A planning report records a 146.5-metre height: https://admin.310front.ca/wp-content/uploads/2021/04/Planning-and-Urban-Design-Rationale-Report_310-330-Front-St-W.pdf . Developer references use 80 Blue Jays Way for the hotel; the residential address is 88. Rooftop pool, terrace, balconies and canopy are simplified architectural details.
- **CN Tower:** modelled to 553.33 metres, with its tapered shaft, three ribs, observation pod, upper pod and antenna. Engineering reference: https://ewh.ieee.org/reg/7/millennium/cntower/cntower_home.html . Observation-level reference: https://www.cntower.ca/plan-your-visit/tickets-and-hours/tickets . Ground position and footprint from OSM 32742038.
- **Rogers Centre:** mapped footprint (OSM 7969701), stadium bowl and simplified open retractable roof; OSM height 86 metres. Building scale reference: https://www.mlb.com/bluejays/ballpark/information/history . Roof state, field and seating are illustrative, not a live stadium feed.

This is a geographically grounded, procedural 3D model, **not** a survey, photogrammetric scan or architectural BIM model. Building textures are generated locally; no photographs or Google map tiles are redistributed. The elevator cutaway is the existing configurable 40-floor simulation; it is not Bisha's actual lift layout or controller. Changing simulation floors does not resize the real-world exterior. The live interior is fitted inside that exterior with G at street level. Approaching Bisha reveals an x-ray of the simulation through its facade and underground parking, while the surrounding city stays in the same scene.
