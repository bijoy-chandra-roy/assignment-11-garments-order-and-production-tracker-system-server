const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const serviceAccount = require("./haystack-firebase-adminsdk.json");
const port = process.env.PORT || 3000

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

app.use(express.json());
app.use(cors());

// Middleware to verify token
const verifyToken = async (req, res, next) => {
    if (!req.headers.authorization) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
    const token = req.headers.authorization.split(' ')[1];
    try {
        const decodedUser = await admin.auth().verifyIdToken(token);
        req.decodedEmail = decodedUser.email;
        next();
    } catch (error) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@assignment-10-hay-stack.do8wqx0.mongodb.net/?appName=assignment-10-hay-stack-database`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        const db = client.db('haystackDB');
        const orderCollection = db.collection('orders');
        const paymentCollection = db.collection('payments');

        // PROTECTED: Post Order
        app.post('/orders', verifyToken, async (req, res) => {
            const order = req.body;
            const result = await orderCollection.insertOne(order);
            res.send(result);
        });

        // PROTECTED: Get Orders by Email
        app.get('/orders', verifyToken, async (req, res) => {
            const email = req.query.email;
            if (req.decodedEmail !== email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            let query = {};
            if (email) {
                query = { email: email };
            }
            const result = await orderCollection.find(query).toArray();
            res.send(result);
        });

        // PROTECTED: Delete Order
        app.delete('/orders/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
        });

        // PROTECTED: Get Single Order (Used for Payment)
        app.get('/orders/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.findOne(query);
            res.send(result);
        });

        // PROTECTED: Create Checkout Session
        app.post('/create-checkout-session', verifyToken, async (req, res) => {
            const { order } = req.body;
            const price = order.totalPrice;
            const amount = Math.round(price * 100);

            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: order.productName || 'Garment Order',
                            },
                            unit_amount: amount,
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment/success?session_id={CHECKOUT_SESSION_ID}&orderId=${order._id}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment/cancelled`,
                customer_email: order.email,
            });

            res.send({ url: session.url });
        });

        // PROTECTED: Payment Success (Db Update)
        app.post('/payments/success', verifyToken, async (req, res) => {
            const { sessionId, orderId } = req.body;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status === 'paid') {
                const transactionId = session.payment_intent;

                const existingPayment = await paymentCollection.findOne({ transactionId: transactionId });
                if (existingPayment) {
                    return res.send({ message: "Payment already processed", paymentResult: { insertedId: null } });
                }

                const order = await orderCollection.findOne({ _id: new ObjectId(orderId) });

                const payment = {
                    orderId: orderId,
                    email: session.customer_details.email,
                    transactionId: transactionId,
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    date: new Date(),
                    status: 'Paid',
                    productName: order?.productName,
                    productImage: order?.productImage,
                    quantity: order?.quantity
                };

                const paymentResult = await paymentCollection.insertOne(payment);

                const query = { _id: new ObjectId(orderId) };
                const updateDoc = {
                    $set: {
                        paymentStatus: 'Paid',
                        transactionId: transactionId
                    }
                };
                const updateResult = await orderCollection.updateOne(query, updateDoc);

                res.send({ paymentResult, updateResult });
            } else {
                res.status(400).send({ message: "Payment not verified" });
            }
        });

        app.get('/payments', verifyToken, async (req, res) => {
            const email = req.query.email;
            if (req.decodedEmail !== email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            if (!email) {
                return res.send([]);
            }
            const query = { email: email };
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        });

        app.get('/payments/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (req.decodedEmail !== email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const query = { email: email };
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        });

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('haystack is stacking...')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})