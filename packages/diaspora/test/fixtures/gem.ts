// Fixtures ported verbatim from the diaspora_federation gem specs and protocol documentation.

/** spec/integration/comment_integration_spec.rb: the private key of alice@pod-a.org. */
export const ALICE_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIICXgIBAAKBgQCxTbMp+M5sCUDVi9k1wMxedSwyLQcjBKQa0Qs6Qpnflz0k90hh
btau0cy9jTK6S3CK2GhERXD6EecDlhZCbnSI9Bwmco5j6NbGPN5ai9tWgiBZzaEr
yOVMQ4qCh1fKOMPX/LCvPzH+K7f8Q92zCuSvKSofg6zpg1zxGahpmxwqFQIDAQAB
AoGBAKEXD2la/XF7FsTuwvLrsMNBgl40Ov+9/7u9oo3UZSmYp50mb0TXB4beZz7x
Qt2wHRiJdnJRBUyvZ00C2EaTRJyFJA8p5J2qzHSjGpbPGyRCZUB6r6y+9vbM4ouj
m5Vo47TQ7ob2D835BHJGR8dWM1zeAwWc6uLhNIu+/5lHQ90BAkEA6aVQFSXNYjmO
fo6Oro+2nDaoa4jJ9qO1S23P2HF9N2f7CHDB4WKTdYnZpXs7ZPbnMEz62LeSC1MZ
QOKGYkMuDQJBAMJEZWvfWtp+Zwm+IF1xGbNPzGrvHGJarE/QGUGYs7BR7tHFlepR
aV3g56eGWfCWk8oWZRbjC2eQ2we96CU4cikCQQCqp3BCwgWthNSrY3yby6RZnSKO
yK6bUx+MJHz3Xo1S9sPIenNiKBoEc9dgow3SxPQ/tzpRKGOnmd6MIeh9xQvRAkAV
6WEHKco1msxEbQ15fKhJcVa9OPsanN+SoQY4P+EEojktr/uY0lXwIM4AN0ctu84v
nRcJ3dILfGs4FFN630MBAkEA3zMOyNTeNdHrVhZc5b0qw2T6FUJGieDpOWLsff4w
84yW10oS2CCmqEhbfh4Wu22amglytrATwD9hDzsTNAt8Mg==
-----END RSA PRIVATE KEY-----
`;

/** The matching public key, as given in a comment of the same spec. */
export const ALICE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCxTbMp+M5sCUDVi9k1wMxedSwy
LQcjBKQa0Qs6Qpnflz0k90hhbtau0cy9jTK6S3CK2GhERXD6EecDlhZCbnSI9Bwm
co5j6NbGPN5ai9tWgiBZzaEryOVMQ4qCh1fKOMPX/LCvPzH+K7f8Q92zCuSvKSof
g6zpg1zxGahpmxwqFQIDAQAB
-----END PUBLIC KEY-----
`;

export const COMMENT_AUTHOR = 'alice@pod-a.org';
export const COMMENT_GUID = 'e21589b0b41101333b870f77ba60fa73';
export const COMMENT_PARENT_GUID = '9e269ae0b41201333b8c0f77ba60fa73';
export const COMMENT_TEXT = 'this is a very informative comment';

export const COMMENT_XML_ALICE = `<comment>
  <author>alice@pod-a.org</author>
  <guid>e21589b0b41101333b870f77ba60fa73</guid>
  <parent_guid>9e269ae0b41201333b8c0f77ba60fa73</parent_guid>
  <text>this is a very informative comment</text>
  <author_signature>SQbLeqsEpFmSl74G1fFJXKQcsq6jp5B2ZjmfEOF/LbBccYP2oZEyEqOq18K3Fa71OYTp6Nddb38hCmHWWHvnGUltGfxKBnQ0WHafJUi40VM4VmeRoU8cac6m+1hslwe5SNmK6oh47EV3mRCXlgGGjLIrw7iEwjKL2g9x1gkNp2s=</author_signature>
</comment>
`;

export const COMMENT_XML_ALICE_WITH_NEW_DATA = `<comment>
  <author>alice@pod-a.org</author>
  <guid>e21589b0b41101333b870f77ba60fa73</guid>
  <parent_guid>9e269ae0b41201333b8c0f77ba60fa73</parent_guid>
  <text>this is a very informative comment</text>
  <new_data>foobar</new_data>
  <author_signature>SFYXSvCX/DhTFiOUALp2Nf1kfNkGKXrnoBPikAyhaIogGydVBm+8tIlu1U/vsnpyKO3yfC3JReJ00/UBd4J16VO1IxStntq8NUqbSv4me5A/6kdK9Xg6eYbXrqQGm8fUQ5Xuh2UzeB71p7SVySXX3OZHVe0dvHCxH/lsfSDpEjc=</author_signature>
</comment>
`;

export const COMMENT_XML_BOB_LEGACY_ORDER = `<comment>
  <guid>e21589b0b41101333b870f77ba60fa73</guid>
  <parent_guid>9e269ae0b41201333b8c0f77ba60fa73</parent_guid>
  <text>this is a very informative comment</text>
  <author>alice@pod-a.org</author>
  <author_signature>XU5X1uqTh8SY6JMG9uhEVR5Rg7FURV6lpRwl/HYOu6DJ3Hd9tpA2aSFFibUxxsMgJXKNrrc5SykrrEdTiQoEei+j0QqZf3B5R7r84qgK7M46KazwIpqRPwVl2MdA/0DdQyYJLA/oavNj1nwll9vtR87M7e/C94qG6P+iQTMBQzo=</author_signature>
</comment>
`;

export const COMMENT_XML_BOB = COMMENT_XML_ALICE;
export const COMMENT_XML_BOB_WITH_NEW_DATA = COMMENT_XML_ALICE_WITH_NEW_DATA;

/** docs/federation/magicsig.md and routes.md: example envelope (legacy payload, signer key unknown). */
export const SPEC_MAGIC_ENVELOPE = `<me:env xmlns:me="http://salmon-protocol.org/ns/magic-env">
  <me:data type="application/xml">PHN0YXR1c19tZXNzYWdlPgogIDxhdXRob3I-YWxpY2VAZXhhbXBsZS5vcmc8L2F1dGhvcj4KICA8Z3VpZD5jYmQ0ODIyMDFmZTEwMTM0ODZmZTMxMzE3MzE3NTFlOTwvZ3VpZD4KICA8Y3JlYXRlZF9hdD4yMDE2LTA2LTI5IDA0OjQyOjIzIFVUQzwvY3JlYXRlZF9hdD4KICA8cmF3X21lc3NhZ2U-aSBhbSBhIHZlcnkgaW50ZXJlc3Rpbmcgc3RhdHVzIHVwZGF0ZTwvcmF3X21lc3NhZ2U-CiAgPHB1YmxpYz50cnVlPC9wdWJsaWM-Cjwvc3RhdHVzX21lc3NhZ2U-</me:data>
  <me:encoding>base64url</me:encoding>
  <me:alg>RSA-SHA256</me:alg>
  <me:sig key_id="YWxpY2VAZXhhbXBsZS5vcmc=">OBv90p9RfAvML28f5H-XDpAWpjk7f4W3I6JMY81OSzXEwPJVndNHRjAxifXd_Id1T7lHylyL0cly4ZBI9frTN5bZZg_03SfiEssZSj0a6KgEnNFIBh1ZG_7WUWon92jJCAO6f2SzVCjdcPSuRYZElFsQSp7zLxAV-Fz5oTdZanY=</me:sig>
</me:env>`;

/** spec/lib/diaspora_federation/discovery/xrd_document_spec.rb */
export const XRD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Expires>2010-01-30T09:30:00Z</Expires>
  <Subject>http://blog.example.com/article/id/314</Subject>
  <Alias>http://blog.example.com/cool_new_thing</Alias>
  <Alias>http://blog.example.com/steve/article/7</Alias>
  <Property type="http://blgx.example.net/ns/version">1.3</Property>
  <Property type="http://blgx.example.net/ns/ext"/>
  <Link rel="author" type="text/html" href="http://blog.example.com/author/steve"/>
  <Link rel="author" href="http://example.com/author/john"/>
  <Link rel="copyright" template="http://example.com/copyright?id={uri}"/>
</XRD>
`;

export const XRD_JSON = `{
  "subject": "http://blog.example.com/article/id/314",
  "expires": "2010-01-30T09:30:00Z",
  "aliases": [
    "http://blog.example.com/cool_new_thing",
    "http://blog.example.com/steve/article/7"
  ],
  "properties": {
    "http://blgx.example.net/ns/version": "1.3",
    "http://blgx.example.net/ns/ext": null
  },
  "links": [
    {
      "rel": "author",
      "type": "text/html",
      "href": "http://blog.example.com/author/steve"
    },
    {
      "rel": "author",
      "href": "http://example.com/author/john"
    },
    {
      "rel": "copyright",
      "template": "http://example.com/copyright?id={uri}"
    }
  ]
}`;

/** docs/discovery/hcard.md: hCard of a real-world shaped profile (4096-bit key). */
export const SPEC_HCARD_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEArxic3b0VuKA+Z1uc6OP4
ha/tRGLYvoxrRjfllnp5hfKyKQfhjVA6xDvvBwamLbzZM+ZEY/4vOhLbC/S3FjVe
opkfQaMvg0uXOB7UhcuKqDM6rFHafsl0LjvBw13p/zQoUxELxK9HAnRLCAAlJ+Fk
MNMR37Rw9Z0Am13Zh4jl64Fn6qkoTHQ/NICbGgRpTmRUrc6KpOKQuQQUJpnGFrJB
g/srgPH4Xdd45VzR6vxjbnEp95F2BOmHLBdGgZAhX+NVY2vuPj2yTn6fFpbVxuUi
XXHSgszLHuH1Nssx7o+KS0jPkQp78ZkW2+fB55MESJSSbWwHuXob5ke7VziHyCFh
3up2kZ5eKPNSpgWqZ3L7HeGjhc+ZtBgJhoUO65Dm/1VOsw8I9uSBNyX7XMa13aO/
Ywn53Rv0L+LDS1yBiirwb6qSCjvvayDeaGLOFoSQ2hNIO+goi3FjrVDYJ1+63NzH
IHj7qcitKxISsPnPYCs49inl8TQC26C43YunEuq8zBDEopeeyXAsnKuX+is6mb6W
hzhzJthFLkmyBd2idgxS/tW6XR9yJ9L0VPafvdth9JUjj510g44BSfJYESRh+4uJ
OFxcL+/diwyswWkVbeaNCrrdfz8LTDQcWv8GA6olBOx7RlgVb7k3HonHaQjaI+xv
9S7fSw27PVS8csWZHwkFGukCAwEAAQ==
-----END PUBLIC KEY-----
`;

export const SPEC_HCARD_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "http://www.w3.org/TR/REC-html40/loose.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta charset="UTF-8" />
    <title>Alice Smith</title>
  </head>
  <body>
    <div id="content">
      <h1>Alice Smith</h1>
      <div id="content_inner" class="entity_profile vcard author">
        <h2>User profile</h2>
        <dl class="entity_uid">
          <dt>Uid</dt>
          <dd>
            <span class="uid">7dba7ca01d64013485eb3131731751e9</span>
          </dd>
        </dl>
        <dl class="entity_full_name">
          <dt>Full_name</dt>
          <dd>
            <span class="fn">Alice Smith</span>
          </dd>
        </dl>
        <dl class="entity_searchable">
          <dt>Searchable</dt>
          <dd>
            <span class="searchable">true</span>
          </dd>
        </dl>
        <dl class="entity_key">
          <dt>Key</dt>
          <dd>
            <pre class="key">${SPEC_HCARD_KEY}</pre>
          </dd>
        </dl>
        <dl class="entity_first_name">
          <dt>First_name</dt>
          <dd>
            <span class="given_name">Alice</span>
          </dd>
        </dl>
        <dl class="entity_family_name">
          <dt>Family_name</dt>
          <dd>
            <span class="family_name">Smith</span>
          </dd>
        </dl>
        <dl class="entity_photo">
          <dt>Photo</dt>
          <dd>
            <img class="photo avatar" width="300" height="300" src="https://example.org/images/thumb_large_a795f872c93309597345.jpg" />
          </dd>
        </dl>
        <dl class="entity_photo_medium">
          <dt>Photo_medium</dt>
          <dd>
            <img class="photo avatar" width="100" height="100" src="https://example.org/images/thumb_medium_a795f872c93309597345.jpg" />
          </dd>
        </dl>
        <dl class="entity_photo_small">
          <dt>Photo_small</dt>
          <dd>
            <img class="photo avatar" width="50" height="50" src="https://example.org/images/thumb_small_a795f872c93309597345.jpg" />
          </dd>
        </dl>
      </div>
    </div>
  </body>
</html>
`;
