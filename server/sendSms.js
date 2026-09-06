// SMS helper for Yuwa Mart.
// Uses Sparrow SMS (a Nepal-based SMS gateway: https://sparrowsms.com) if you configure
// SPARROW_TOKEN in your .env file. Until then, it runs in "simulation mode":
// the OTP/message is just logged on the server and returned in the API response
// so the app keeps working end-to-end during testing.

const SPARROW_TOKEN = process.env.SPARROW_TOKEN || '';
const SPARROW_FROM = process.env.SPARROW_FROM || 'YuwaMart';

async function sendSms(phone, message) {
  if (!SPARROW_TOKEN) {
    console.log(`[SMS SIMULATION - no SPARROW_TOKEN set] To: ${phone} | Message: ${message}`);
    return { simulated: true, sent: false };
  }
  try {
    const params = new URLSearchParams({
      token: SPARROW_TOKEN,
      from: SPARROW_FROM,
      to: phone,
      text: message,
    });
    const res = await fetch(`https://api.sparrowsms.com/v2/sms/?${params.toString()}`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    return { simulated: false, sent: true, response: data };
  } catch (err) {
    console.error('SMS send failed, falling back to simulation log:', err.message);
    console.log(`[SMS FALLBACK] To: ${phone} | Message: ${message}`);
    return { simulated: true, sent: false, error: err.message };
  }
}

module.exports = sendSms;
