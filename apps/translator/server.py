"""
Machine translation for Disbigle, on this machine: Bergamot (the engine of Firefox
Translations) with Mozilla's models, behind a small subset of the LibreTranslate API so
the server can use either.

    GET  /languages   [{"code": "it", "name": "Italian", "targets": ["en", "es", ...]}]
    POST /translate   {"q": str | [str], "source": "it" | "auto", "target": "es",
                       "format": "html" | "text"}
                   -> {"translatedText": str | [str],
                       "detectedLanguage": {"language": "it", "confidence": 93.1}}
    GET  /health      {"status": "ok", "loaded": ["it-en", ...]}

Every model translates to or from English: other pairs go through English. A model is
loaded on its first use and dropped after IDLE_SECONDS without requests.
"""

import argparse
import json
import os
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bergamot
from py3langid.langid import MODEL_FILE, LanguageIdentifier

MAX_CHARS = 20_000
IDLE_SECONDS = int(os.environ.get("TRANSLATOR_IDLE_SECONDS", "600"))

NAMES = {
    "ar": "Arabic", "bg": "Bulgarian", "ca": "Catalan", "cs": "Czech", "da": "Danish",
    "de": "German", "el": "Greek", "en": "English", "es": "Spanish", "et": "Estonian",
    "fa": "Persian", "fi": "Finnish", "fr": "French", "hr": "Croatian", "hu": "Hungarian",
    "id": "Indonesian", "is": "Icelandic", "it": "Italian", "ja": "Japanese", "ko": "Korean",
    "lt": "Lithuanian", "lv": "Latvian", "nb": "Norwegian Bokmål", "nl": "Dutch",
    "pl": "Polish", "pt": "Portuguese", "ro": "Romanian", "ru": "Russian", "sk": "Slovak",
    "sl": "Slovenian", "sq": "Albanian", "sr": "Serbian", "sv": "Swedish", "tr": "Turkish",
    "uk": "Ukrainian", "vi": "Vietnamese", "zh": "Chinese",
}

CONFIG = """models: [{dir}/{model}]
vocabs: [{dir}/{src_vocab}, {dir}/{trg_vocab}]
shortlist: [{dir}/{lex}, false]
beam-size: 1
normalize: 1.0
word-penalty: 0
max-length-break: 128
mini-batch-words: 1024
workspace: 128
max-length-factor: 2.0
skip-cost: true
cpu-threads: 0
quiet: true
quiet-translation: true
gemm-precision: int8shiftAlphaAll
alignment: soft
"""


class BadRequest(Exception):
    pass


class Translator:
    def __init__(self, models_dir: str, workers: int):
        self.models_dir = models_dir
        self.service = bergamot.Service(bergamot.ServiceConfig(numWorkers=workers, logLevel="off"))
        # Pairs on disk, as "it-en".
        self.pairs = {
            name for name in os.listdir(models_dir)
            if len(name.split("-")) == 2 and os.path.isdir(os.path.join(models_dir, name))
        }
        self.languages = sorted({lang for pair in self.pairs for lang in pair.split("-")})
        # Language identification limited to the languages there are models for.
        self.identifier = LanguageIdentifier.from_model_file(MODEL_FILE, norm_probs=True)
        self.identifier.set_languages([l for l in self.languages if l in self.identifier.nb_classes])
        self.loaded: dict[str, tuple[object, float]] = {}
        self.lock = threading.Lock()

    def targets(self, source: str) -> list[str]:
        return [t for t in self.languages if t != source and self.route(source, t)]

    def route(self, source: str, target: str) -> list[str] | None:
        if f"{source}-{target}" in self.pairs:
            return [f"{source}-{target}"]
        if f"{source}-en" in self.pairs and f"en-{target}" in self.pairs:
            return [f"{source}-en", f"en-{target}"]
        return None

    def model(self, pair: str):
        entry = self.loaded.get(pair)
        if entry is None:
            entry = (self.service.modelFromConfigPath(self.write_config(pair)), 0.0)
        self.loaded[pair] = (entry[0], time.monotonic())
        return entry[0]

    def write_config(self, pair: str) -> str:
        directory = os.path.abspath(os.path.join(self.models_dir, pair))
        files = os.listdir(directory)

        def find(prefix: str, suffix: str) -> str:
            matches = sorted(f for f in files if f.startswith(prefix) and f.endswith(suffix))
            if not matches:
                raise RuntimeError(f"{pair}: no {prefix}*{suffix}")
            return matches[0]

        vocabs = sorted(f for f in files if f.endswith(".spm"))
        src_vocab = next((f for f in vocabs if f.startswith("srcvocab")), vocabs[0])
        trg_vocab = next((f for f in vocabs if f.startswith("trgvocab")), vocabs[0])
        path = os.path.join(directory, "config.bergamot.yml")
        with open(path, "w") as config:
            config.write(CONFIG.format(
                dir=directory,
                model=find("model.", ".bin"),
                lex=find("lex.", ".bin"),
                src_vocab=src_vocab,
                trg_vocab=trg_vocab,
            ))
        return path

    def detect(self, texts: list[str]) -> tuple[str, float]:
        language, probability = self.identifier.classify(" ".join(texts))
        return language, round(float(probability) * 100, 1)

    def translate(self, texts: list[str], source: str, target: str, html: bool) -> list[str]:
        route = self.route(source, target)
        if route is None:
            raise BadRequest(f"{source} to {target} is not available")
        options = bergamot.ResponseOptions(alignment=False, qualityScores=False, HTML=html)
        todo = [i for i, text in enumerate(texts) if text.strip()]
        result = list(texts)
        if not todo:
            return result
        batch = bergamot.VectorString([texts[i] for i in todo])
        with self.lock:
            models = [self.model(pair) for pair in route]
            if len(models) == 1:
                responses = self.service.translate(models[0], batch, options)
            else:
                responses = self.service.pivot(models[0], models[1], batch, options)
        for i, response in zip(todo, responses):
            result[i] = response.target.text
        return result

    def unload_idle(self):
        while True:
            time.sleep(60)
            with self.lock:
                now = time.monotonic()
                for pair, (_, used) in list(self.loaded.items()):
                    if now - used > IDLE_SECONDS:
                        del self.loaded[pair]


def handler(translator: Translator):
    class Handler(BaseHTTPRequestHandler):
        server_version = "disbigle-translator"

        def log_message(self, format, *args):
            pass

        def send_json(self, status: int, body):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            # Shown under translations ("Translated by …"); LibreTranslate doesn't send it.
            self.send_header("X-Translation-Provider", "Bergamot")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/languages":
                self.send_json(200, [
                    {"code": lang, "name": NAMES.get(lang, lang), "targets": translator.targets(lang)}
                    for lang in translator.languages
                ])
            elif self.path == "/health":
                self.send_json(200, {"status": "ok", "loaded": sorted(translator.loaded)})
            else:
                self.send_json(404, {"error": "Not found"})

        def do_POST(self):
            if self.path != "/translate":
                return self.send_json(404, {"error": "Not found"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if length > MAX_CHARS * 4 + 1024:
                    return self.send_json(413, {"error": "Text too long"})
                body = json.loads(self.rfile.read(length) or b"{}")
                q, source, target = body.get("q"), body.get("source", "auto"), body.get("target")
                single = isinstance(q, str)
                texts = [q] if single else q
                if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                    raise BadRequest("Invalid request parameter: q")
                if sum(len(t) for t in texts) > MAX_CHARS:
                    return self.send_json(413, {"error": "Text too long"})
                if not isinstance(target, str) or target not in translator.languages:
                    raise BadRequest(f"{target} is not supported")
                response = {}
                if source == "auto":
                    source, confidence = translator.detect(texts)
                    response["detectedLanguage"] = {"language": source, "confidence": confidence}
                if source == target:
                    translated = list(texts)
                else:
                    translated = translator.translate(texts, source, target, body.get("format") == "html")
                response["translatedText"] = translated[0] if single else translated
                self.send_json(200, response)
            except (BadRequest, ValueError) as error:
                self.send_json(400, {"error": str(error)})
            except Exception as error:  # noqa: BLE001 - the caller only needs a failure
                self.send_json(500, {"error": f"Translation failed: {error}"})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--models", default=os.environ.get("TRANSLATOR_MODELS", "./models"))
    parser.add_argument("--host", default=os.environ.get("TRANSLATOR_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("TRANSLATOR_PORT", "5100")))
    parser.add_argument("--workers", type=int, default=int(os.environ.get("TRANSLATOR_WORKERS", "2")))
    args = parser.parse_args()
    translator = Translator(args.models, args.workers)
    threading.Thread(target=translator.unload_idle, daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), handler(translator))
    print(f"Translating {', '.join(translator.languages)} on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
