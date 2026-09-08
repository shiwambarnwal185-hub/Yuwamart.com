// Sends an email to the owner every time a new order comes in.
// Uses the owner's own Gmail account via an "App Password" — completely free,
// no third-party email service or account needed.
//
// Setup (see README.md for full steps):
//   1. Turn on 2-Step Verification on the Gmail account you want to send from.
//   2. Create an "App Password" at https://myaccount.google.com/apppasswords
//   3. Set these in your .env file:
//        GMAIL_USER=youraddress@gmail.com
//        GMAIL_APP_PASSWORD=the16charapppassword
//        OWNER_EMAIL=whereyouwanttoreceivenotifications@gmail.com   (can be the same address)

const nodemailer = require('nodemailer');

const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const OWNER_EMAIL = process.env.OWNER_EMAIL || GMAIL_USER;

let transporter = null;
if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

async function sendOrderNotificationEmail(order) {
  if (!transporter) {
    console.log(`[EMAIL SIMULATION - Gmail not configured] New order ${order.id} — would have emailed ${OWNER_EMAIL}`);
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
    await transporter.sendMail({
      from: `"Yuwa Mart" <${GMAIL_USER}>`,
      to: OWNER_EMAIL,
      subject: `🛒 New Order ${order.id} — Rs. ${order.grandTotal} (COD)`,
      text,
    });
    return { sent: true };
  } catch (err) {
    console.error('Failed to send order notification email:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = sendOrderNotificationEmail;
