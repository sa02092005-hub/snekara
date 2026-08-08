// Payment integration scaffolding for Razorpay and Cashfree.
// Both gateways are wired behind a common interface so checkout.js
// can call /api/payments/:gateway/create and /verify without branching.

const crypto = require('crypto');
const Order = require('../models/Order');

let razorpayInstance = null;
function getRazorpay() {
  if (!razorpayInstance) {
    const Razorpay = require('razorpay');
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayInstance;
}

// @POST /api/payments/razorpay/create
// Creates a Razorpay order for an existing Snekaara order and returns
// the gateway order_id for the frontend Checkout.js widget to consume.
exports.createRazorpayOrder = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    const instance = getRazorpay();
    const rzpOrder = await instance.orders.create({
      amount: Math.round(order.total * 100), // paise
      currency: 'INR',
      receipt: order.orderNumber,
      notes: { snekaaraOrderId: order._id.toString() },
    });

    order.paymentDetails.orderId = rzpOrder.id;
    await order.save();

    res.json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      razorpayOrderId: rzpOrder.id,
      orderNumber: order.orderNumber,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/payments/razorpay/verify
// Verifies the HMAC signature returned by Razorpay Checkout after payment.
exports.verifyRazorpayPayment = async (req, res) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification failed.' });
    }

    const order = await Order.findById(orderId);
    order.paymentStatus = 'paid';
    order.paymentDetails.paymentId = razorpay_payment_id;
    order.paymentDetails.signature = razorpay_signature;
    order.orderStatus = 'confirmed';
    order.statusHistory.push({ status: 'confirmed', note: 'Payment verified via Razorpay' });
    await order.save();

    res.json({ success: true, message: 'Payment verified successfully.', order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/payments/cashfree/create
// Creates a Cashfree payment session for an existing order.
// Uses Cashfree's Payment Gateway REST API (PG v2023-08-01) directly via fetch
// so no extra SDK dependency is required.
exports.createCashfreeOrder = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId).populate('user', 'name email phone');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    const payload = {
      order_id: order.orderNumber,
      order_amount: order.total,
      order_currency: 'INR',
      customer_details: {
        customer_id: order.user._id.toString(),
        customer_name: order.user.name,
        customer_email: order.user.email,
        customer_phone: order.shippingAddress.phone || order.user.phone || '9999999999',
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL}/pages/order-tracking.html?order=${order.orderNumber}`,
      },
    };

    const response = await fetch('https://sandbox.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': '2023-08-01',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ success: false, message: data.message || 'Cashfree order creation failed.' });
    }

    order.paymentDetails.orderId = data.order_id || order.orderNumber;
    await order.save();

    res.json({ success: true, paymentSessionId: data.payment_session_id, orderNumber: order.orderNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/payments/cashfree/verify
// Confirms order status directly with Cashfree after redirect, since
// Cashfree's hosted checkout returns the browser to return_url rather
// than handing back a signature like Razorpay does.
exports.verifyCashfreePayment = async (req, res) => {
  try {
    const { orderNumber } = req.body;

    const response = await fetch(`https://sandbox.cashfree.com/pg/orders/${orderNumber}`, {
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': '2023-08-01',
      },
    });
    const data = await response.json();

    const order = await Order.findOne({ orderNumber });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (data.order_status === 'PAID') {
      order.paymentStatus = 'paid';
      order.orderStatus = 'confirmed';
      order.statusHistory.push({ status: 'confirmed', note: 'Payment verified via Cashfree' });
      await order.save();
      return res.json({ success: true, message: 'Payment verified successfully.', order });
    }

    res.json({ success: false, message: `Payment status: ${data.order_status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/payments/cod/confirm
// Cash-on-delivery requires no gateway call — just marks the order confirmed.
exports.confirmCOD = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    order.orderStatus = 'confirmed';
    order.statusHistory.push({ status: 'confirmed', note: 'Cash on Delivery order confirmed' });
    await order.save();
    res.json({ success: true, message: 'Order confirmed.', order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
