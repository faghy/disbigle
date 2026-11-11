"""Revokes the development certificates that Xcode creates on CI runners.

Every GitHub Actions run starts on a fresh Mac, so automatic signing creates a new development
certificate ("Created via API", type DEVELOPMENT) whose private key is lost with the runner.
Apple allows only a few of them: without this cleanup, signing fails after a handful of runs.
Personal certificates (IOS_DEVELOPMENT, made in Xcode) and the distribution ones are kept.

Environment: KEY (the .p8 contents), KEY_ID, ISSUER_ID.
"""

import os
import time

import jwt
import requests

token = jwt.encode(
    {
        'iss': os.environ['ISSUER_ID'],
        'iat': int(time.time()),
        'exp': int(time.time()) + 600,
        'aud': 'appstoreconnect-v1',
    },
    os.environ['KEY'],
    algorithm='ES256',
    headers={'kid': os.environ['KEY_ID']},
)
api = 'https://api.appstoreconnect.apple.com/v1'
headers = {'Authorization': f'Bearer {token}'}

response = requests.get(
    f'{api}/certificates',
    params={'filter[certificateType]': 'DEVELOPMENT', 'limit': 200},
    headers=headers,
    timeout=30,
)
response.raise_for_status()
revoked = 0
for certificate in response.json()['data']:
    attributes = certificate['attributes']
    names = f"{attributes.get('displayName') or ''} {attributes.get('name') or ''}"
    if 'Created via API' not in names:
        continue
    result = requests.delete(f"{api}/certificates/{certificate['id']}", headers=headers, timeout=30)
    print('Revoked' if result.ok else f'Not revoked ({result.status_code})', certificate['id'],
          attributes.get('expirationDate'))
    revoked += result.ok
print(f'{revoked} CI development certificate(s) revoked')
