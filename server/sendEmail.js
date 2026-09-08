// Sends an email to the owner every time a new order comes in.
//
// IMPORTANT: This uses Resend (https://resend.com) over plain HTTPS, not
// traditional SMTP — because Render's free tier blocks outbound SMTP ports
// (25, 465, 587) to prevent spam abuse. Resend's free plan (100 emails/day,
// no credit card) works perfectly since it just makes a normal HTTPS request.
//
// Setup (see README.md for full steps):
//   1. Sign up free at https://resend.com (no card needed)
//   2. Get your API key from https://resend.com/api-keys
//   3. Set these in your .env file:
//        RESEND_API_KEY=re_xxxxxxxxxxxx
//        OWNER_EMAIL=whereyouwanttoreceivenotifications@gmail.com
//   Note: without verifying your own domain on Resend, you can only send TO
//   the email address you signed up to Resend with — which is exactly what
//   we need here, since it's just notifying you, the owner.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const OWNER_EMAIL = process.env.OWNER_EMAIL || '';

async function sendOrderNotificationEmail(order) {
  if (!RESEND_API_KEY || !OWNER_EMAIL) {
    console.log(`[EMAIL SIMULATION - Resend not configured] New order ${order.id} — would have emailed ${OWNER_EMAIL || '(no OWNER_EMAIL set)'}`);
    return { simulated: true };
  }

  const itemLines = order.items.map(it => `  • ${it.name} × ${it.qty} — Rs. ${it.price * it.qty}`).join('\n');
  const mapLink = (order.lat && order.lng) ? `https://www.google.com/maps?q=${order.lat},${order.lng}` : 'Not available';

  const text = `New order received on Yuwa Mart!

Order ID: ${order.id}
Customer: ${order.name} (${order.customerId || 'Guest'})
Phone: ${order.phone}
Address: ${order.address}
Live location: ${mapLink}

Items:
${itemLines}

Item Total: Rs. ${order.itemTotal}
Delivery Fee: Rs. ${order.deliveryFee}
Grand Total: Rs. ${order.grandTotal} (Cash on Delivery)
Estimated delivery time: ${order.etaMin} minutes
OTP: ${order.otp}

Open your Owner Dashboard to update the order status.`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Yuwa Mart <onboarding@resend.dev>',
        to: [OWNER_EMAIL],
        subject: `🛒 New Order ${order.id} — Rs. ${order.grandTotal} (COD)`,
        text,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error('Resend API error:', res.status, errBody);
      return { sent: false, error: errBody };
    }
    return { sent: true };
  } catch (err) {
    console.error('Failed to send order notification email:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = sendOrderNotificationEmail;
