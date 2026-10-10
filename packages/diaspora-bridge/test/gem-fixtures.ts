// Fixtures from the diaspora_federation gem (spec/integration/comment_integration_spec.rb).

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
export const ALICE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCxTbMp+M5sCUDVi9k1wMxedSwy
LQcjBKQa0Qs6Qpnflz0k90hhbtau0cy9jTK6S3CK2GhERXD6EecDlhZCbnSI9Bwm
co5j6NbGPN5ai9tWgiBZzaEryOVMQ4qCh1fKOMPX/LCvPzH+K7f8Q92zCuSvKSof
g6zpg1zxGahpmxwqFQIDAQAB
-----END PUBLIC KEY-----
`;
export const COMMENT_XML_ALICE = `<comment>
  <author>alice@pod-a.org</author>
  <guid>e21589b0b41101333b870f77ba60fa73</guid>
  <parent_guid>9e269ae0b41201333b8c0f77ba60fa73</parent_guid>
  <text>this is a very informative comment</text>
  <author_signature>SQbLeqsEpFmSl74G1fFJXKQcsq6jp5B2ZjmfEOF/LbBccYP2oZEyEqOq18K3Fa71OYTp6Nddb38hCmHWWHvnGUltGfxKBnQ0WHafJUi40VM4VmeRoU8cac6m+1hslwe5SNmK6oh47EV3mRCXlgGGjLIrw7iEwjKL2g9x1gkNp2s=</author_signature>
</comment>
`;
