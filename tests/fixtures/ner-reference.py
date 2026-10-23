# Reference values for tests/models.test.mjs (biomedical NER, Stage 2 of docs/ML.md).
# Needs: tokenizers, onnxruntime, transformers, optimum[onnxruntime], and the model files:
#   npm run fetch:models            (downloads web/models/biomedical-ner-all/model.onnx)
#   python3 tests/fixtures/ner-reference.py
# Writes tests/fixtures/ner-reference.json:
#  - tokenizer ids/offsets from Hugging Face `tokenizers` (tokenizer.json at the pinned revision),
#  - logits from onnxruntime (Python) for the int8 ONNX model and for the full-precision (fp32) model,
#  - entities from transformers' token-classification pipeline (aggregation_strategy "simple" and "first").
import json, os, sys
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
from transformers import AutoTokenizer, pipeline
from optimum.onnxruntime import ORTModelForTokenClassification
from huggingface_hub import hf_hub_download

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO, REV = 'onnx-community/biomedical-ner-all-ONNX', '6ceb893e772562380b0072dec34ef748e8faadd0'
MODEL = os.path.join(ROOT, 'web', 'models', 'biomedical-ner-all', 'model.onnx')
if not os.path.exists(MODEL):
    sys.exit('Run `npm run fetch:models` first.')

TEXTS = [
    'CASE: A 28-year-old previously healthy man presented with a 6-week history of palpitations. The symptoms occurred during rest, 2–3 times per week, lasted up to 30 minutes at a time and were associated with dyspnea.',
    'A 48 year-old female presented with vaginal bleeding and abnormal Pap smears. Upon diagnosis of invasive non-keratinizing SCC of the cervix, she underwent a radical hysterectomy with salpingo-oophorectomy.',
    'Patients received pembrolizumab 200 mg every 3 weeks; grade 3 pneumonitis occurred in 4% (n=12). Café-au-lait macules, naïve T-cells and the EGFR L858R mutation were noted.',
    'Héllo wörld — 50µg/kg i.v. q12h ×3 days; ß-blockers, (IL-6) [CRP] {TNF-α} “quoted”   tabs\tand\nnewlines.',
]

hf_tok = Tokenizer.from_pretrained(REPO, revision=REV)
tok = []
for t in TEXTS:
    e = hf_tok.encode(t)
    tok.append({'ids': e.ids, 'offsets': [list(o) for o in e.offsets], 'tokens': e.tokens})

sess = ort.InferenceSession(MODEL)
logits = []
for e in tok[:3]:
    ids = np.array([e['ids']], dtype=np.int64)
    out = sess.run(['logits'], {'input_ids': ids, 'attention_mask': np.ones_like(ids)})[0][0]
    logits.append(out.astype(float).round(7).tolist())

# full-precision model at the same revision: the yardstick for quantisation error
f32 = ort.InferenceSession(hf_hub_download(REPO, 'onnx/model.onnx', revision=REV))
logits_fp32 = []
for e in tok[:3]:
    ids = np.array([e['ids']], dtype=np.int64)
    logits_fp32.append(f32.run(['logits'], {'input_ids': ids, 'attention_mask': np.ones_like(ids)})[0][0].astype(float).round(5).tolist())

tokenizer = AutoTokenizer.from_pretrained(REPO, revision=REV)
# optimum loads config.json from the directory that holds model.onnx
model = ORTModelForTokenClassification.from_pretrained(os.path.dirname(MODEL), file_name='model.onnx')
ents = {}
for strategy in ['simple', 'first']:
    nlp = pipeline('token-classification', model=model, tokenizer=tokenizer, aggregation_strategy=strategy)
    ents[strategy] = [[{'entity': x['entity_group'], 'score': float(x['score']), 'start': int(x['start']), 'end': int(x['end']), 'word': x['word']} for x in nlp(t)] for t in TEXTS[:3]]

json.dump({'repo': REPO, 'revision': REV, 'texts': TEXTS, 'tokenizer': tok, 'logits': logits, 'logits_fp32': logits_fp32, 'onnxruntime': ort.__version__, 'entities': ents}, open(os.path.join(ROOT, 'tests', 'fixtures', 'ner-reference.json'), 'w'))
print('wrote tests/fixtures/ner-reference.json')
