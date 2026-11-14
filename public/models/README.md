# Furniture models

Put glTF binary files here, named after the `model` field of a furniture
piece in the scene file. A piece with `"model": "armchair"` loads
`/models/armchair.glb`. The model is scaled evenly to fit the piece's
`size`, turned to face the right way (see `MODEL_FIT` in
`src/render/furnitureView.ts`) and stood on the floor. When no file exists,
the app draws the model built in code (`src/render/models.ts`).

Only add models with a CC0 licence, and note the source of each one below.
The files were made from the 1k glTF downloads with
`gltf-transform optimize <in.gltf> <out.glb> --texture-compress webp --texture-size 512`
(1024 for the floor plant), which also compresses the geometry with meshopt.

| File | Source | Licence |
| --- | --- | --- |
| armchair.glb | [Modern Arm Chair 01](https://polyhaven.com/a/modern_arm_chair_01), Poly Haven | CC0 |
| coffee-table.glb | [Modern Coffee Table 01](https://polyhaven.com/a/modern_coffee_table_01), Poly Haven | CC0 |
| dining-chair.glb | [Dining Chair 02](https://polyhaven.com/a/dining_chair_02), Poly Haven | CC0 |
| floor-plant.glb | [Potted Plant 01](https://polyhaven.com/a/potted_plant_01), Poly Haven | CC0 |
| round-table.glb | [Round Wooden Table 02](https://polyhaven.com/a/round_wooden_table_02), Poly Haven | CC0 |
| side-table.glb | [Side Table 01](https://polyhaven.com/a/side_table_01), Poly Haven | CC0 |
| table-plant.glb | [Potted Plant 04](https://polyhaven.com/a/potted_plant_04), Poly Haven | CC0 |
| vase.glb | [Ceramic Vase 01](https://polyhaven.com/a/ceramic_vase_01), Poly Haven | CC0 |

Not used, and why: Poly Haven's sofas are all traditional (chesterfield,
carved frames), so the modern sofa stays code-built; its dining table has a
checked tablecloth; its planter boxes are rustic crates; its trees are over
90 MB of geometry, far too heavy for a phone.
