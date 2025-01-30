const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();
app.use(express.json());

const SECURITY_KEY = 'Asdiw2737y#376';
const CHECK_INTERVAL = 30000; // 30 seconds

const API_CONFIG = {
    baseUrl: 'https://app.ghazaresan.com/api/',
    endpoints: {
        auth: 'Authorization/Authenticate',
        orders: 'Orders/GetOrders'
    }
};

// Initialize Firebase Admin with service account
const firebaseConfig = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
    credential: admin.credential.cert(firebaseConfig),
    projectId: process.env.FIREBASE_PROJECT_ID
});

// Store active users and their check intervals
const activeUsers = new Map();

// Endpoint to register new users
app.post('/register', async (req, res) => {
    const { username, password, fcmToken } = req.body;
    
    try {
        const authResponse = await authenticateUser(username, password);
        if (!authResponse.success) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        activeUsers.set(fcmToken, {
            username,
            password,
            lastOrderId: null,
            checkInterval: null
        });
        
        startChecking(fcmToken);
        
        res.json({ success: true, message: 'Registration successful' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

async function authenticateUser(username, password) {
    try {
        const authUrl = `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.auth}`;
        const response = await axios.post(authUrl, {
            username,
            password
        }, {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'securitykey': SECURITY_KEY,
                'Origin': 'https://portal.ghazaresan.com',
                'Referer': 'https://portal.ghazaresan.com/'
            }
        });
        
        // Add validation for response.data.Token
        if (response.data && response.data.Token) {
            return { success: true, token: response.data.Token };
        }
        return { success: false, message: 'Invalid token response' };
    } catch (error) {
        console.log('Auth Response:', error.response?.data);
        return { success: false, message: error.message };
    }
}
async function checkOrders(username, password, fcmToken) {
    if (!fcmToken) {
        console.log('Missing FCM token, skipping check');
        return;
    }

    const user = activeUsers.get(fcmToken);
    if (!user) {
        console.log('User not found for token:', fcmToken);
        return;
    }

    try {
        const auth = await authenticateUser(username, password);
        if (!auth.success) {
            console.log('Authentication failed:', auth.message);
            return;
        }
        const ordersUrl = `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.orders}`;
        const ordersResponse = await axios.post(ordersUrl, {
            authorizationCode: auth.token,
            securityKey: SECURITY_KEY
        }, {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'authorizationcode': auth.token,
                'securitykey': SECURITY_KEY,
                'Origin': 'https://portal.ghazaresan.com',
                'Referer': 'https://portal.ghazaresan.com/'
            }
        });

        const newOrders = ordersResponse.data.filter(order => order.Status === 0);
        
          if (newOrders.length > 0) {
           const message = {
    token: fcmToken,
  notification: {
    title: 'سفارش جدید غذارسان',
    body: `شما ${newOrders.length} سفارش جدید دارید`  // The template literal will be evaluated before sending
},
    android: {
        priority: 'high',
        ttl: '60s',
        notification: {
            channelId: 'orders_channel',
            priority: 'max',
            defaultSound: true,
            defaultVibrateTimings: true ,
             visibility: 'public',
            importance: 'max'
        }
    },
    data: {
        orderCount: newOrders.length.toString()
    }
};
            
            console.log('Sending FCM message with token:', fcmToken);
            console.log('Message payload:', JSON.stringify(message, null, 2));

            const response = await admin.messaging().send(message);
            console.log('FCM message sent successfully:', response);
        }
    } catch (error) {
        console.error('Order check error:', error);
console.error('Error details:', error.response ? error.response.data : error.message);
console.log('Firebase Credentials:', process.env.FIREBASE_CREDENTIALS);

    }
}

function startChecking(fcmToken) {
    const user = activeUsers.get(fcmToken);
    if (!user) return;

    if (user.checkInterval) {
        clearInterval(user.checkInterval);
    }

    user.checkInterval = setInterval(() => {
        checkOrders(user.username, user.password, fcmToken);
    }, CHECK_INTERVAL);

    activeUsers.set(fcmToken, user);
}

app.post('/unregister', (req, res) => {
    const { fcmToken } = req.body;
    const user = activeUsers.get(fcmToken);
    
    if (user && user.checkInterval) {
        clearInterval(user.checkInterval);
    }
    
    activeUsers.delete(fcmToken);
    res.json({ success: true });
});

// Add health check endpoint for Koyeb
app.get('/', (req, res) => {
    res.json({ status: 'running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
