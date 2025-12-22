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
        const userCollection = db.collection('users');
        const productCollection = db.collection('products');

        const verifyAdmin = async (req, res, next) => {
            const email = req.decodedEmail;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        const verifyManager = async (req, res, next) => {
            const email = req.decodedEmail;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isManager = user?.role === 'manager';
            if (!isManager) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        app.post('/products', verifyToken, verifyManager, async (req, res) => {
            const item = req.body;
            const result = await productCollection.insertOne(item);
            res.send(result);
        });

        app.get('/products', async (req, res) => {
            const result = await productCollection.find().toArray();
            res.send(result);
        });

        app.delete('/products/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await productCollection.deleteOne(query);
            res.send(result);
        });

        app.patch('/products/:id', verifyToken, async (req, res) => {
            const item = req.body;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: { ...item }
            }
            const result = await productCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        // Manager: Get all pending orders
        app.get('/orders/pending', verifyToken, verifyManager, async (req, res) => {
            const result = await orderCollection.find({ status: 'Pending' }).toArray();
            res.send(result);
        });

        // Manager: Approve or Reject order
        app.patch('/orders/status/:id', verifyToken, verifyManager, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            const filter = { _id: new ObjectId(id) };
            
            let updatedDoc = {
                $set: {
                    status: status
                }
            };

            // If approving, log the timestamp
            if(status === 'Approved') {
                updatedDoc.$set.approvedAt = new Date();
            }

            const result = await orderCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        // Manager: Get all approved/active orders (Excludes Pending, Rejected, or Cancelled)
        app.get('/orders/approved', verifyToken, verifyManager, async (req, res) => {
            const result = await orderCollection.find({ 
                status: { $nin: ['Pending', 'Rejected', 'Cancelled'] } 
            }).sort({ approvedAt: -1 }).toArray();
            res.send(result);
        });

        // Manager: Add tracking info and update order status
        app.patch('/orders/tracking/:id', verifyToken, verifyManager, async (req, res) => {
            const id = req.params.id;
            const { status, location, note, date } = req.body;
            const filter = { _id: new ObjectId(id) };
            
            const updatedDoc = {
                $push: {
                    trackingHistory: {
                        status,
                        location,
                        note,
                        date,
                        timestamp: new Date()
                    }
                },
                $set: {
                    status: status // Updates the main status to the latest tracking stage
                }
            }
            const result = await orderCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists', insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        });

        app.post('/orders', verifyToken, async (req, res) => {
            const order = req.body;
            const result = await orderCollection.insertOne(order);
            res.send(result);
        });

        app.get('/orders', verifyToken, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decodedEmail;

            const queryUser = { email: decodedEmail };
            const user = await userCollection.findOne(queryUser);
            const isAdmin = user?.role === 'admin';

            if (!isAdmin && email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            let query = {};
            if (email) {
                query = { email: email };
            }
            
            const result = await orderCollection.find(query).toArray();
            res.send(result);
        });

        app.delete('/orders/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
        });

        app.get('/orders/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.findOne(query);
            res.send(result);
        });

        app.get('/products/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await productCollection.findOne(query);
            res.send(result);
        });

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

        app.get('/users', verifyToken, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        app.delete('/users/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result);
        });

        app.patch('/users/admin/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        app.get('/users/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (req.decodedEmail !== email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const query = { email: email };
            const result = await userCollection.findOne(query);
            res.send(result);
        });

        // Admin Statistics Endpoint
        app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount();
            const products = await productCollection.estimatedDocumentCount();
            const orders = await orderCollection.estimatedDocumentCount();

            // Calculate Total Revenue
            // We use MongoDB Aggregation Pipeline to sum up the 'totalPrice' field of all orders
            const payments = await orderCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: '$totalPrice' }
                    }
                }
            ]).toArray();

            const revenue = payments.length > 0 ? payments[0].totalRevenue : 0;

            res.send({
                users,
                products,
                orders,
                revenue
            });
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