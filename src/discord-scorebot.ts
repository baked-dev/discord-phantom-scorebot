import { Client, Message, TextChannel } from 'discord.js';
import * as express from 'express';
import { json } from 'body-parser';
import * as v4 from 'uuid/v4';
import { post } from 'request-promise-native';

const baseURI = '';
const discordToken = '';
const webhook = '';

const sleep = (duration: number) => new Promise(resolve => setTimeout(resolve, duration));

export default new class DiscordScorebot extends Client {

    private app: express.Express = express();
    private events: {
        [eventid: string]: {
            scoremessage: Message,
            score: {
                [userid: string]: {
                    declines: number,
                    checkouts: number
                }
            },
            name: string
        }
    } = {};

    constructor () {
        super();
        this.start();
    }

    private start = async () => {
        this.login(discordToken);
        this.on('message', this.handleMessage);
        this.app.use(json());
        this.app.post([
            '/webhook/:eventid/:userid', '/webhook/:eventid/:userid/slack'
        ], (req: express.Request, res: express.Response) => {
            const { eventid, userid } = req.params;
            let change = false
            if (req.body.attachments[0].title.toLowerCase().startsWith('checkout')) {
                if (this.events[eventid]) {
                    if (this.events[eventid].score[userid]) {
                        this.events[eventid].score[userid].checkouts ++;
                    } else {
                        this.events[eventid].score[userid] = {
                            declines: 0,
                            checkouts: 1
                        }
                    }
                }
                change = true;
            }
            if (req.body.attachments[0].title.toLowerCase().startsWith('declined')) {
                if (this.events[eventid]) {
                    if (this.events[eventid].score[userid]) {
                        this.events[eventid].score[userid].declines ++;
                    } else {
                        this.events[eventid].score[userid] = {
                            declines: 1,
                            checkouts: 0
                        }
                    }
                }
                change = true
            }
            if (change) this.updateScoreMessage(eventid);
            this.forwardMessage(req.body);
            res.status(200).send('OK');
        });
        this.app.listen(2525);
    }

    private forwardMessage = async (message) => {
        try {
            await post(webhook, {
                json: true,
                body: message
            });
        } catch (e) {
            let retry;
            try {
                retry = JSON.parse(e.message.split(' - ')[1]).retry_after;
            } catch(e) {
                retry = undefined;
            } finally {
                await sleep(retry?retry:5000)
                this.forwardMessage(message);
            }
        }
    }

    private updateScoreMessage = eventid => {
        if (this.events[eventid]) {
            this.events[eventid].scoremessage.edit(this.makeScoreMessage(this.events[eventid]));
        }
    }

    private makeEventName = (base: string, i: number = 0) => {
        if (i) {
            base = base + i.toString()
        }
        for (const eventid of Object.keys(this.events)) if (this.events[eventid].name === base) return this.makeEventName(base.slice(0, -1), ++i);
        return base;
    }

    private createNewEvent = async (name: string, message: Message) => {
        name = this.makeEventName(name);
        const id = v4();
        const event: any = {
            name,
            score: {}
        }
        event.scoremessage = await message.channel.send(this.makeScoreMessage(event));
        this.events[id] = event;
    }

    private makeScoreMessage = (event: { name: string, score: { [userid: string]: { 
        declines: number,
        checkouts: number
    } } }) => {
        return `Score for ${event.name}:
    
    ${Object.keys(event.score).map(userid => `@${this.users.get(userid).username} : checkouts: ${event.score[userid].checkouts}, declines: ${event.score[userid].declines}`).join('\n')}    `
}

    private handleMessage = async (message: Message) => {
        if (message.content.startsWith('/')) {
            const [ command, ...params ] = message.content.split(' ');
            switch (command) {
                case '/newevent':
                    const [ name ] = params;
                    this.createNewEvent(name, message);
                    return;
                case '/scorewebhook':
                    const [ eventname ] = params;
                    for (const eventid of Object.keys(this.events)) {
                        if (this.events[eventid].name === eventname) {
                            return message.reply(`${baseURI}/webhook/${eventid}/${message.author.id}`);
                        }
                    }
                default: {
                    return message.reply('idk wtf you talking about boi');
                }
            }
        }
    }

}