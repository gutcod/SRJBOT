import express from 'express';
import bodyParser  from "body-parser";
import {Client, LogLevel} from '@notionhq/client';
import TelegramBot from 'node-telegram-bot-api';
import * as dotenv from 'dotenv'
import {CreatePageResponse} from "@notionhq/client/build/src/api-endpoints";

dotenv.config()

const API_NOTION = process.env.API_NOTION;
const databaseId = process.env.DATABASE_ID
const TELEGRAM_BOT_TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const PERCENTAGE = Number(process.env.PERCENTAGE);

// Store user data for expense form
const userExpenseData = {};

const app = express();

app.use(bodyParser.json());

const notion = new Client({ auth: API_NOTION, logLevel:LogLevel.DEBUG });
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });



// Define a route that creates a new row in the database
const addTableRow = async ({ name, amount,details })=> {
    const date = new Date().toISOString().split('T')[0];
    try {
        const newPage = {
            properties: {
                Name: {
                    title: [
                        {
                            text: {
                                content: name,
                            },
                        },
                    ],
                },
                Details: {
                    rich_text: [
                        {
                            text: {
                                content: details,
                            },
                        },
                    ],
                },
                Amount: {
                    number: parseFloat(amount),
                },
                Date: {
                    date: {
                        start: date,
                    },
                },
            },
        };

        const response:CreatePageResponse = await notion.pages.create({
            parent: {
                database_id: databaseId,
            },
            properties: newPage.properties,
        });

        console.log(`New row added to Notion database: ${response.id}`);
        return response.id;
    } catch (error) {
        console.error(error);
        throw new Error('Failed to add row to Notion database.');
    }
}


//Notion Post/Get
const handleExpensePost = (req, res) => {
    const { name, details, amount } = req.body;
    try{
            addTableRow({ name, details, amount })
                .then((result) => {
                    res.json({ message: 'Row added to Notion table.', id: result });
                })
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const handleExpenseGet = async () => {
    try {
        const response = await notion.databases.query({
            database_id: databaseId,
            filter: {
                property: 'Date',
                date: {
                    past_month: {},
                }
            }
        });

        return response.results;
    } catch (error) {
        console.error(error);
        throw new Error('Error retrieving expenses');
    }
};

// Start the Telegram bot
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    // Create the inline keyboard markup with initial options
    const keyboard = {
        inline_keyboard: [
            [
                { text: 'CABINET-1', callback_data: 'pfa1' },
                { text: 'CABINET-2', callback_data: 'pfa2' }
            ]
        ]
    };

    // Create the message options with the inline keyboard
    const options = {
        reply_markup: JSON.stringify(keyboard)
    };

    // Send the welcome message with the inline keyboard
    bot.sendMessage(chatId, 'Welcome to the Expense Tracker bot! Please select an option:', options);
});

// Handle button callback queries
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const queryData = query.data;

    if (queryData === 'pfa1' || queryData === 'pfa2') {
        // Create the inline keyboard markup based on the selection
        const keyboard = {
            inline_keyboard: [
                [
                    { text: 'Add Expense', callback_data: 'addexpense' },
                    { text: 'Get Expense Total', callback_data: 'getexpensetotal' }
                ]
            ]
        };

        // Create the message options with the inline keyboard
        const options = {
            reply_markup: JSON.stringify(keyboard)
        };

        // Send the message with the appropriate buttons
        bot.sendMessage(chatId, `You have selected ${queryData}. Please choose an action:`, options);
    }
});

// Handle button callback queries
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const queryData = query.data;

    if (queryData === 'addexpense') {
        // Store the user's cabinet as the queryData
        userExpenseData[chatId] = { cabinet: queryData };

        await askForName(chatId);
    }
    if(queryData === 'getexpensetotal'){
        // get all the expenses
        const data = await handleExpenseGet();
        const client  = data.length;
        const total = data.reduce((acc, curr) => acc + curr['properties'].Amount.number, 0);
        const percentSRJ = total*PERCENTAGE;
        const diffCabinet = total-percentSRJ;
        await bot.sendMessage(chatId,`Pacienti aceasta luna:${client} \n Total Venit: ${total}  \n Cabinet: ${diffCabinet} \n SRJ: ${percentSRJ}`);
        await restartBot(chatId);
    }
});

// Function to ask for the expense name
async function askForName(chatId) {
    await bot.sendMessage(chatId, 'Please enter the expense name:', {
        reply_markup: {
            force_reply: true
        }
    });
}

// Handle user input for name, amount, and details
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    if (userExpenseData[chatId] && !userExpenseData[chatId].name) {
        userExpenseData[chatId].name = messageText;

        await askForAmount(chatId);
    } else if (userExpenseData[chatId] && !userExpenseData[chatId].amount) {
        userExpenseData[chatId].amount = messageText;

        await askForDetails(chatId);
    } else if (userExpenseData[chatId] && !userExpenseData[chatId].details) {
        userExpenseData[chatId].details = messageText;

        await displayConfirmation(chatId);
    }
});

// Function to ask for the expense amount
async function askForAmount(chatId) {
    await bot.sendMessage(chatId, 'Please enter the expense amount:', {
        reply_markup: {
            force_reply: true
        }
    });
}

// Function to ask for the expense details
async function askForDetails(chatId) {
    await bot.sendMessage(chatId, 'Please enter the expense details:', {
        reply_markup: {
            force_reply: true
        }
    });
}

async function restartBot(chatId) {
    // start bot again
    await bot.sendMessage(chatId, 'Please select an option:', {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'CABINET-1', callback_data: 'pfa1' },
                    { text: 'CABINET-2', callback_data: 'pfa2' }
                ]
            ]
        }
    })
}

// Function to display the confirmation message
async function displayConfirmation(chatId) {
    const { name,amount,details } = userExpenseData[chatId];
    if (name && amount && details) {
        await bot.sendMessage(chatId, `Expense Name: ${userExpenseData[chatId].name}\nExpense Amount: ${userExpenseData[chatId].amount}\nExpense Details: ${userExpenseData[chatId].details}`, {
        });
            // Perform necessary actions with the expense data, e.g., store it in a database
            await handleExpensePost({ body: { name, amount, details } }, { json: () => {bot.sendMessage(chatId, 'Expense added successfully!'); } });
            // start bot again
            await restartBot(chatId);

    }
}





export default app;