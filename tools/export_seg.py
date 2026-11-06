"""Экспорт UperNet + ConvNeXt-Tiny (ADE20K, MIT, openmmlab) в ONNX для браузера.
Выход: логиты 150×128×128 (без финального апсемплинга), затем int8-квантование."""
import json, hashlib, os, sys, numpy as np, torch
from transformers import UperNetForSemanticSegmentation
from onnxruntime.quantization import quantize_dynamic, QuantType
import onnxruntime as ort

src = 'openmmlab/upernet-convnext-tiny'
m = UperNetForSemanticSegmentation.from_pretrained(src).eval()

class Head(torch.nn.Module):
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, pixel_values):
        feats = s.m.backbone.forward_with_filtered_kwargs(pixel_values).feature_maps
        return s.m.decode_head(feats)

x = torch.randn(1, 3, 512, 512)
with torch.no_grad():
    ref = Head(m)(x)
print('logits', tuple(ref.shape))
os.makedirs('out', exist_ok=True)
torch.onnx.export(Head(m), x, 'out/fp32.onnx', input_names=['pixel_values'], output_names=['logits'], opset_version=17, dynamo=False)
quantize_dynamic('out/fp32.onnx', 'out/int8.onnx', weight_type=QuantType.QUInt8)

# проверка: совпадение argmax fp32 vs int8 на нескольких входах
s32 = ort.InferenceSession('out/fp32.onnx'); s8 = ort.InferenceSession('out/int8.onnx')
agree = []
for i in range(3):
    xi = np.random.RandomState(i).randn(1, 3, 512, 512).astype('float32') * 0.8
    a = s32.run(None, {'pixel_values': xi})[0].argmax(1); b = s8.run(None, {'pixel_values': xi})[0].argmax(1)
    agree.append(float((a == b).mean()))
print('argmax agreement int8 vs fp32:', agree)
d = torch.from_numpy(s32.run(None, {'pixel_values': x.numpy()})[0]) - ref
print('fp32 onnx vs torch max diff', float(d.abs().max()))

data = open('out/int8.onnx', 'rb').read()
os.makedirs('seg', exist_ok=True)
CH = 18 * 1024 * 1024
parts = []
for i in range(0, len(data), CH):
    name = f'seg/upernet-convnext-tiny-ade-int8.part{len(parts)}'
    open(name, 'wb').write(data[i:i + CH]); parts.append(os.path.basename(name))
json.dump({'source': src, 'license': 'MIT', 'format': 'onnx int8 (dynamic)', 'input': 'pixel_values [1,3,512,512] ImageNet-normalized RGB',
           'output': 'logits [1,150,128,128]', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'parts': parts,
           'argmax_agreement_vs_fp32': agree}, open('seg/manifest.json', 'w'), ensure_ascii=False, indent=1)
print('size', len(data), 'parts', parts)
