"""Synthetic corpus only. Run with OLLAMA_BASE_URL pointing to the test server."""
import concurrent.futures
import json
import math
import os
import re
import time
import sys
import urllib.error
import urllib.request

base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
cases = {
    "synthesis": ("Fonte F1: a máquina fictícia Lira retém eventos por nove dias, apenas se o coletor estiver ativo. Resuma em português com a condição e cite [F1].",
                  lambda s: ("nove" in s or "9" in s) and "coletor" in s and "ativ" in s and "[f1]" in s),
    "code": ("Complete a expressão TypeScript que retorna o maior entre a e b. Responda somente com a expressão.",
             lambda s: s.strip().strip(";") in ["math.max(a,b)", "math.max(a, b)", "a > b ? a : b", "a >= b ? a : b"])
}

def call(path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(base + "/api/" + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)

def grade(capability, output):
    answer = output.lower()
    if capability == "code":
        expression = re.sub(r"^return\s+", "", answer.strip().strip("`").strip()).rstrip(";")
        return dict(passed=cases["code"][1](answer), semantic_pass=cases["code"][1](expression))
    portuguese = not re.search(r"\b(?:okay|user wants|the user|translating|summary in portuguese)\b", answer)
    semantic = portuguese and ("nove" in answer or "9" in answer) and "coletor" in answer and "ativ" in answer and bool(re.search(r"apenas se|somente se|desde que", answer))
    return dict(passed=semantic and "[f1]" in answer, semantic_pass=semantic)

def bench(model, capability, parallel):
    start = time.monotonic()
    stats = dict(model=model, capability=capability, concurrency=parallel)
    try:
        if capability == "embeddings":
            result = call("embed", {"model": model, "input": ["Prazo para manter os registros", "Retenção de eventos", "Receita de bolo de cenoura"]})
            vec, related, unrelated = result["embeddings"]
            def cosine(x, y):
                return sum(a*b for a,b in zip(x,y)) / math.sqrt(sum(a*a for a in x)*sum(b*b for b in y))
            stats.update(dim=len(vec), related=cosine(vec, related), unrelated=cosine(vec, unrelated))
            stats["passed"] = stats["related"] > stats["unrelated"]
        else:
            prompt, score = cases[capability]
            result = call("chat", {"model":model, "messages":[{"role":"user","content":prompt}], "stream":False,
                                   "think":False, "options":{"temperature":0,"num_predict":100,"num_ctx":2048}})
            stats["output"] = result["message"]["content"]
            stats.update(grade(capability, stats["output"]))
        stats["load_ms"] = round(result.get("load_duration",0)/1e6,1)
        running = next((m for m in call("ps")["models"] if m["name"] == model), {})
        stats.update(resident_bytes=running.get("size"), vram_bytes=running.get("size_vram"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as err:
        stats.update(passed=False, error=type(err).__name__, status=getattr(err, "code", None))
    stats["wall_ms"]=round((time.monotonic()-start)*1000)
    return stats

if "--rescore" in sys.argv:
    for line in sys.stdin:
        record = json.loads(line)
        if "output" in record:
            record.update(grade(record["capability"], record["output"]))
        print(json.dumps(record))
    sys.exit(0)

for model in ["qwen3:1.7b","qwen3:4b"]:
    for cap in [*cases, "embeddings"]:
        print(json.dumps(bench(model,cap,1)), flush=True)
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        for result in pool.map(lambda c: bench(model,c,2), list(cases)):
            print(json.dumps(result), flush=True)
