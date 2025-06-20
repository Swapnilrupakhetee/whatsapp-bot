require('dotenv').config();
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Path where the session data will be stored
const SESSION_FILE_PATH = './session.json';
// Path to store users who have received the promotional and follow-up messages
const PROMO_SENT_FILE = './promo-sent.json';

// Environment variables with fallback values
const country_code = process.env.COUNTRY_CODE || '977';
const number = process.env.NUMBER || '9866804473';
const msg = process.env.MSG || 'this is a test';

// Promotional reply for the first message
const PROMO_REPLY = 'Enjoy 10% OFF on your purchase as one of our first 10 buyers! Plus, get an additional 10% OFF when you refer a friend.';
// Follow-up reply for the second message
const FOLLOWUP_REPLY = 'Thank you for your inquiry, we will get back to you soon.';

// Load or initialize the sets of users who have received the promo and follow-up messages
let promoSentUsers = new Set();
let followupSentUsers = new Set();
if (fs.existsSync(PROMO_SENT_FILE)) {
    try {
        const data = fs.readFileSync(PROMO_SENT_FILE, 'utf8');
        const { promo, followup } = JSON.parse(data);
        promoSentUsers = new Set(promo || []);
        followupSentUsers = new Set(followup || []);
    } catch (err) {
        console.error('Error loading promo-sent file:', err);
    }
}

// Function to save the promoSentUsers and followupSentUsers to a file
function savePromoSentUsers() {
    try {
        fs.writeFileSync(PROMO_SENT_FILE, JSON.stringify({
            promo: [...promoSentUsers],
            followup: [...followupSentUsers]
        }));
        console.log('Saved promo-sent and followup-sent users to file.');
    } catch (err) {
        console.error('Error saving promo-sent file:', err);
    }
}

// Initialize WhatsApp client with LocalAuth strategy
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_FILE_PATH }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
        ],
        executablePath: process.env.CHROMIUM_PATH || null,
        timeout: 60000,
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
});

// Initialize the client with retry logic
async function initializeClient() {
    try {
        console.log('Initializing WhatsApp client...');
        await client.initialize();
    } catch (err) {
        console.error('Client initialization failed:', err);
        console.log('Retrying initialization in 5 seconds...');
        setTimeout(initializeClient, 5000);
    }
}

initializeClient();

// Handle QR code generation
client.on('qr', (qr) => {
    console.log('QR Code received, scan it with your WhatsApp app:');
    qrcode.generate(qr, { small: true }, (err) => {
        if (err) console.error('Error generating QR code:', err);
    });
});

// Handle authentication
client.on('authenticated', () => {
    console.log('Authenticated successfully!');
});

// Handle authentication failure
client.on('auth_failure', (msg) => {
    console.error('Authentication Failure:', msg);
    if (fs.existsSync(SESSION_FILE_PATH)) {
        fs.unlinkSync(SESSION_FILE_PATH);
        console.log('Deleted session file. Restart the script to generate a new QR code.');
    }
});

// Handle client ready event
client.on('ready', async () => {
    console.log('Client is ready!');

    // Format the chat ID
    const chatId = `${country_code}${number}@c.us`;

    try {
        // Verify if the number is valid and registered on WhatsApp
        const isValidNumber = await client.isRegisteredUser(chatId);
        if (!isValidNumber) {
            console.error(`The number ${country_code}${number} is not registered on WhatsApp.`);
            return;
        }

        // Send the initial test message
        const response = await client.sendMessage(chatId, msg);
        console.log(`Initial message sent to ${chatId}: "${msg}"`);
    } catch (error) {
        console.error('Error sending initial message:', error);
    }
});

// Handle all incoming messages
client.on('message', async (message) => {
    // Log all incoming messages
    console.log(`[INCOMING] From: ${message.from}, To: ${message.to}, Message: ${message.body}, Timestamp: ${new Date(message.timestamp * 1000).toISOString()}`);

    // Convert message to lowercase for case-insensitive matching
    const messageText = message.body.toLowerCase();

    // Define keywords for price and services
    const priceKeywords = ['price', 'cost', 'rate', 'how much', 'pricing'];
    const serviceKeywords = ['services', 'offer', 'what do you do', 'product', 'offerings'];

    // Check for price-related queries
    if (priceKeywords.some(keyword => messageText.includes(keyword))) {
        const reply = 'Thank you for your inquiry! Our pricing depends on the service you choose. For example, our basic plan starts at $10/month, and premium plans are $25/month. Please let me know which service you’re interested in for a detailed quote!';
        await message.reply(reply);
        console.log(`[REPLY] Sent price info to ${message.from}: "${reply}"`);
        return;
    }

    // Check for service-related queries
    if (serviceKeywords.some(keyword => messageText.includes(keyword))) {
        const reply = 'We offer a range of services including web development, mobile app development, and digital marketing. Let me know if you’d like more details about any specific service!';
        await message.reply(reply);
        console.log(`[REPLY] Sent services info to ${message.from}: "${reply}"`);
        return;
    }

    // Respond to "Hello" messages
    if (messageText === 'hello') {
        await message.reply('World!');
        console.log(`[REPLY] Sent "World!" to ${message.from}`);
        return;
    }

    // Check if the user has received the follow-up message
    const sender = message.from;
    if (followupSentUsers.has(sender)) {
        console.log(`[IGNORE] No reply sent to ${sender} as they have already received the follow-up message.`);
        return;
    }

    // Check if the user has received the promotional message
    if (!promoSentUsers.has(sender)) {
        // Send promotional reply for the first message
        await message.reply(PROMO_REPLY);
        console.log(`[REPLY] Sent promotional info to ${sender}: "${PROMO_REPLY}"`);
        promoSentUsers.add(sender);
        savePromoSentUsers(); // Save the updated sets to file
    } else {
        // Send follow-up reply for the second message
        await message.reply(FOLLOWUP_REPLY);
        console.log(`[REPLY] Sent follow-up info to ${sender}: "${FOLLOWUP_REPLY}"`);
        followupSentUsers.add(sender);
        savePromoSentUsers(); // Save the updated sets to file
    }
});

// Handle all messages (including outgoing messages sent by the bot or device)
client.on('message_create', async (message) => {
    // Log all messages created by the bot or the linked device
    if (message.fromMe) {
        console.log(`[OUTGOING] From: ${message.from}, To: ${message.to}, Message: ${message.body}, Timestamp: ${new Date(message.timestamp * 1000).toISOString()}`);
    }
});

// Handle client errors
client.on('disconnected', (reason) => {
    console.error('Client disconnected:', reason);
    if (fs.existsSync(SESSION_FILE_PATH)) {
        fs.unlinkSync(SESSION_FILE_PATH);
        console.log('Deleted session file. Restarting client...');
        initializeClient();
    }
});

// Handle general errors
client.on('error', (error) => {
    console.error('General error:', error);
});