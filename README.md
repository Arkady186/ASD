# Служебная ветка `models`

Модели нейросетей для примерки кухни на сайте (раздаются через jsDelivr, не попадают в GitHub Pages).

- `seg/` — UperNet + ConvNeXt-Tiny, обучена на ADE20K (openmmlab/upernet-convnext-tiny, лицензия MIT), ONNX int8, разрезана на части ≤ 18 МБ. Собирается автоматически workflow `build segmentation model` из `tools/export_seg.py`.
