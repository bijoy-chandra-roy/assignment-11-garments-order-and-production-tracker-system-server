const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@assignment-10-hay-stack.do8wqx0.mongodb.net/?appName=assignment-10-hay-stack-database`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('haystackDB');
        const orderCollection = db.collection('orders');
        const paymentCollection = db.collection('payments');

        // api
        app.post('/orders', async (req, res) => {
            const order = req.body;
            const result = await orderCollection.insertOne(order);
            res.send(result);
        });

        // POST Order
        app.post('/orders', async (req, res) => {
            const order = req.body;
            const result = await orderCollection.insertOne(order);
            res.send(result);
        });

        // GET Orders (Filtered by email)
        app.get('/orders', async (req, res) => {
            const email = req.query.email;
            let query = {};
            if (email) {
                query = { email: email };
            }
            const result = await orderCollection.find(query).toArray();
            res.send(result);
        });

        // DELETE Order
        app.delete('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
        });

        // GET Single Order
        app.get('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.findOne(query);
            res.send(result);
        });

        // 1. Create Stripe Checkout Session
        app.post('/create-checkout-session', async (req, res) => {
            const { order } = req.body;
            const price = order.totalPrice;
            const amount = Math.round(price * 100); // Stripe uses cents

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
                        quantity: 1, // Quantity is 1 because 'totalPrice' calculates the full cost
                    },
                ],
                mode: 'payment',
                // Redirect URLs - Make sure port matches your client (5173 usually)
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment/success?session_id={CHECKOUT_SESSION_ID}&orderId=${order._id}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment/cancelled`,
                customer_email: order.email,
            });

            res.send({ url: session.url });
        });

        // 2. Verify & Save Payment
        app.post('/payments/success', async (req, res) => {
            const { sessionId, orderId } = req.body;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status === 'paid') {
                const transactionId = session.payment_intent;

                // Checking for duplicate payment
                const existingPayment = await paymentCollection.findOne({ transactionId: transactionId });
                if (existingPayment) {
                    return res.send({ message: "Payment already processed", paymentResult: { insertedId: null } });
                }

                const payment = {
                    orderId: orderId,
                    email: session.customer_details.email,
                    transactionId: transactionId,
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    date: new Date(),
                    status: 'Paid'
                };

                const paymentResult = await paymentCollection.insertOne(payment);

                // Update Order Status
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

        // GET Payments by Email
        app.get('/payments', async (req, res) => {
            const email = req.query.email;
            if (!email) {
                return res.send([]);
            }
            const query = { email: email };
        });

        // GET Payments History
        app.get('/payments/:email', async (req, res) => {
            const query = { email: req.params.email };
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('haystack is stacking...')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
