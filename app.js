
const { Client, Location, List, Buttons, LocalAuth, MessageMedia } = require('whatsapp-web.js/index');
const mkdirp = require('mkdirp');
const FileSystem = require('fs');
const getDirName = require('path').dirname;
require('dotenv').config();
const fetch = require('node-fetch')


FileSystem.readFile(process.env.WHITELIST, 'utf8', (err, data) => {
    if (err) {
        console.error(err)
        return
    }
    //console.log(data)
    whitelist = data.replace(/\n|\r/g, "").split(',')
})

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: false }
});

client.initialize();

client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr)
})

client.on('authenticated', () => {
    console.log('AUTHENTICATED')
})

function timeConverter(UNIX_timestamp) {
    var a = new Date(UNIX_timestamp * 1000);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var year = a.getFullYear();
    var month = months[a.getMonth()];
    var date = a.getDate();
    var hour = a.getHours();
    var min = a.getMinutes();
    var sec = a.getSeconds();
    var time = date + '_' + month + '_' + year + '_' + hour + '_' + min + '_' + sec;
    return time;
}

function convertToCSV(items) {
    const replacer = (key, value) => value === null ? '' : value // specify how you want to handle null values here
    const header = Object.keys(items[0])
    const csv = [
        header.join(','), // header row first
        ...items.map(row => header.map(fieldName => JSON.stringify(row[fieldName], replacer)).join(','))
    ].join('\r\n')

    return csv
}

function writeFile(path, contents, cb) {
    mkdirp(getDirName(path), function (err) {
        if (err) return cb(err);

        FileSystem.writeFile(path, contents, cb);
    });
}

function downloadtopath(media, message) {
    FileSystem.writeFile(process.env.EXPORT_PATH +
        timeConverter(message.timestamp) + '_' + message.id.id + '.jpg', media.data, 'base64', function (err) {
            if (err) {
                console.log(err)
            }
        }
    )
}

async function fetchMessagesTill(chat, time) {
    let batch = 0
    //increment fetching 50 by 50 messages
    fetchMessages = async function () {
        batch += 50
        msg = await chat.fetchMessages({ 'limit': batch })
        console.log(msg.length)
        return msg
    }
    messages = await fetchMessages()
    //check earliest message time
    var lastMessageTime = new Date(messages[0].timestamp * 1000)
    var checktime = new Date(time)
    while (lastMessageTime > checktime) {
        messages = await fetchMessages()
        lastMessageTime = new Date(messages[0].timestamp * 1000)
        checktime = new Date(time)
    }
    //filter message in time range
    final_messages = messages.filter(msg => new Date(msg.timestamp * 1000) > checktime)
    return final_messages
}

client.on('ready', async () => {
    console.log('READY')

    //load specific chat base on chat name
    chats = await client.getChats()
    chat = chats.find(chat => {
        return chat.name === process.env.CHAT_NAME
    })
    console.log(chat)

    //load messages within chat
    fetchMessagesTill(chat, process.env.FETCH_MSG_TIME).then(async (messages) => {
        //selected chat placeholder
        var safety_case = []
        var caseNum = 0
        //loop messages
        for ([index, message] of messages.entries()) {
            console.log(message)

            //if have media
            if (message.hasMedia) {
                var mediaFileName = timeConverter(message.timestamp) + '_' + message.id.id + '.jpg';

                //download media
                media = await message.downloadMedia()
                downloadtopath(media, message)

                //record media saved name
                message['mediaFileName'] = mediaFileName
                //if the message is quoting another message
                if (message.hasQuotedMsg && !whitelist.includes(message.author.replace('@c.us', ''))) {
                    var quotedMsg = await message.getQuotedMessage()
                    var responseTo = messages.find(msg => {
                        return msg.id._serialized === quotedMsg.id._serialized
                    })
                    if (responseTo == null) {
                        message['caseType'] = 'R_' + quotedMsg.id._serialized
                    } else { message['caseType'] = 'R_' + responseTo.caseType }

                } else {
                    try {
                        //handle text is seperated from picture
                        if (message.body == '') {
                            if (messages[index + 1].body !== null && messages[index + 1].author == message.author && messages[index + 1].hasMedia == false) {
                                message.body = messages[index + 1].body
                            }
                        }
                        caseNum += 1
                        message['caseType'] = 'C' + caseNum
                        if (message.body.match('\d+.\d+(.\d+)?')) {
                            message['score'] = message.body.match('\d+.\d+(.\d+)?').join(' & ')
                        } else {
                            message['score'] = ''
                        }
                    } catch (error) {
                        console.log(error)
                    }
                }

                //push chat content into selected cases
                safety_case.push({
                    'author': message.author,
                    'body': message.body,
                    'score': message.score,
                    'caseType': message.caseType,
                    'deviceType': message.deviceType,
                    'from': message.from,
                    'id': message.id._serialized,
                    'location': message.location,
                    'mediaFileName': message.mediaFileName,
                    'mediaKey': message.mediaKey,
                    'timestamp': message.timestamp,
                    'type': message.type
                })
            }
        }
        console.table(safety_case)
        FileSystem.writeFile(process.env.EXPORT_PATH + 'WhatsappChats.csv', "\ufeff" + convertToCSV(safety_case), 'utf8', function (err) {
            if (err) {
                console.log(err)
            }
        })

    }

    )

})

