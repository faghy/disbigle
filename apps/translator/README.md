# Translator

Optional machine translation of posts ("Translate" under a post written in another
language). It runs on your server: the text of posts is not sent to anyone else.

- Engine: [Bergamot](https://browser.mt) (`bergamot` on PyPI), the engine of Firefox
  Translations, with Mozilla's released models (about 35 MB per direction, CPU only).
- Language identification for posts without a language: py3langid.
- API: the subset of [LibreTranslate](https://libretranslate.com)'s used by Disbigle
  (`GET /languages`, `POST /translate` with `q`, `source`, `target`, `format`), so
  `TRANSLATION_URL` can point to a LibreTranslate server instead.

Every model translates to or from English; other pairs go through English. A model is
loaded on first use (≈200 MB of memory while loaded) and dropped after 10 idle minutes
(`TRANSLATOR_IDLE_SECONDS`).

## Install

The `bergamot` wheels are built for Python 3.10; [uv](https://docs.astral.sh/uv/)
provides one without touching the system Python.

```sh
sudo -u disbigle uv venv -p 3.10 /opt/disbigle/translator-venv
sudo -u disbigle uv pip install -p /opt/disbigle/translator-venv -r apps/translator/requirements.txt
sudo mkdir -p /var/lib/disbigle/translator/models && sudo chown -R disbigle: /var/lib/disbigle/translator
sudo -u disbigle /opt/disbigle/translator-venv/bin/python apps/translator/download_models.py \
  --models /var/lib/disbigle/translator/models it es fr de pt
sudo cp deploy/disbigle-translator.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now disbigle-translator
```

Then add `TRANSLATION_URL=http://127.0.0.1:5100` to `/etc/disbigle/env` and restart the
server and the worker. Without `TRANSLATION_URL` the feature is off.

To add a language later, run `download_models.py` with its code and restart the service.
