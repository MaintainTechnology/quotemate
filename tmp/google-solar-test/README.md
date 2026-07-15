# Google Solar API test — 670 London Road, Chandler QLD

Test date: 2026-07-15

## Endpoint results

- Address geocoding: successful
- `buildingInsights:findClosest`: successful
- `dataLayers:get`: successful
- Imagery quality: `MEDIUM`
- Imagery date: 2017-10-27
- Google roof segments: 22
- Whole-roof area: 585.85 m²
- Building ground area: 522.89 m²

The returned `roofSegmentStats` objects contain `pitchDegrees`, `azimuthDegrees`, area statistics, center, bounding box, and `planeHeightAtCenterMeters`.

They do **not** contain hip, ridge, valley, eave, gutter, rake, typed-edge, facet-polygon, or roof-topology fields.

## Data layers

The request returned:

- RGB raster: 399 × 400 pixels
- DSM raster: 399 × 400 pixels
- Binary building mask: 399 × 400 pixels
- Pixel size: 0.25 m
- Coordinate system: EPSG:32756

The mask represents building footprints, not individual roof facets or typed roof lines.

## Experimental inference

A local proof of concept assigned the 22 reported plane equations to the DSM inside the main building mask:

- Main mask area: 523.25 m²
- Assigned planes: 22/22
- Median plane-fit residual: 0.069 m
- 90th-percentile residual: 0.196 m

This demonstrates that the plane metadata and DSM can support custom facet reconstruction.

The naive adjacency classifier produced 6 ridge, 12 hip, 4 valley, 17 eave candidates, and 20 unresolved internal junctions. Those numbers are **not accepted measurements**: raster fragmentation and the lack of returned facet polygons caused over-counting and ambiguous topology.

## Conclusion

Google Solar API cannot directly count hips, ridges, valleys, or eaves. It can supply strong inputs for a custom 3D topology pipeline, but that pipeline still needs facet-boundary reconstruction, graph cleanup, confidence scoring, and human review.

No API key was written to the test files.
