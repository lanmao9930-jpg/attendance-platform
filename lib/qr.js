const QRCode = require("qrcode");
const { QR_INTERVAL_MS, makeQrToken } = require("./security");
const { publicOrigin } = require("./url");

async function currentQrPayload(req) {
  const slot = Math.floor(Date.now() / QR_INTERVAL_MS);
  const expiresAt = (slot + 1) * QR_INTERVAL_MS;
  const origin = publicOrigin(req);
  const token = await makeQrToken(slot);
  const checkinUrl = `${origin}/student?token=${encodeURIComponent(token)}`;
  return {
    token,
    intervalMs: QR_INTERVAL_MS,
    expiresAt,
    checkinUrl,
    qrSvgUrl: `/api/qr.svg?token=${encodeURIComponent(token)}`
  };
}

async function makeQrSvg(text) {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 3,
    width: 420,
    color: {
      dark: "#111827",
      light: "#ffffff"
    }
  });
}

module.exports = {
  currentQrPayload,
  makeQrSvg
};
