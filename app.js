/*
 * Copyright 2022 Luis Martins <luis.martins@gmail.com>
 * 
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 */

const { Gpio } = require('onoff');

const os = require('os');
const mqtt = require('mqtt');

const grand9k = require('grand9k');
const ssd1306 = require('ssd1306');

const TextAlign = {
  RIGHT: 0b001,
  CENTER: 0b010,
  LEFT: 0b100
}

const Screen = {
  SPLASH: 0,
  TEMPERATURE: 1,
  PRESSURE: 2,
  HUMIDITY: 3,
  ALARM: 4,
  WEATHER: 5,
  VOLTAGE: 6
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const address = () => {
  const interfaces = os.networkInterfaces();

  for(const name of Object.keys(interfaces)) {
    const ip = interfaces[name].find(net => net.internal == false && net.family == 'IPv4');

    if(ip != undefined) {
      return ip.address;
    }
  }
}

console.log('Starting R nineT status monitor...')

const client = mqtt.connect('mqtt://localhost:1883', {
  clientId: 'r9t-status'
});

let ready = false;
let connected = false;
let values = {};

client.on('connect', () => {
  console.log('Connected to MQTT broker.');

  client.subscribe(['voltage/main', 'weather/+', 'alarm/weather', 'config/status']);
  client.options.reconnectPeriod = 1000;
  connected = true;
});

client.on('close', () => {
  if(connected) {
    console.log('Connection to MQTT broker lost.');
    connected = false;
  }
});

client.on('message', (topic, message) => {
  switch(topic) {
    case 'voltage/main':
      values.voltage = parseFloat(message);
      voltage(values.voltage);
      break;
    case 'weather/temperature':
      values.temperature = parseFloat(message);
      temperature(values.temperature);
      break;
    case 'weather/pressure':
      values.pressure = parseFloat(message);
      pressure(values.pressure);
      break;
    case 'weather/humidity':
      values.humidity = parseFloat(message);
      humidity(values.humidity);
      break;
    case 'alarm/weather':
      values.alarm = parseInt(message, 2);
      alarm(values.alarm, true);
      break;
    case 'config/status':
      const config = JSON.parse(message);
      screen = config.screen;
      break;
  }
});

client.on('error', (error) => {
  switch(error.code) {
    case 'ECONNREFUSED':
       console.log(`Unable to connect to MQTT broker on ${error.address}:${error.port}.`);
      break;

    default:
      console.log(error);
      break;
  }
});

/*
 * Increase the time between connection attempts
 */
client.on('reconnect', () => {
  client.options.reconnectPeriod *= 2;
});

// used to rotate between the different status screens available
const button = new Gpio('17', 'in', 'both', { debounceTimeout: 50 }); // [none, rising, falling, both]

let press = undefined;
let screen = Screen.SPLASH;

button.watch(async (error, value) => {
  if(error) {
    console.log(error);
    return;
  }

  // capture the button press and exit, handle the button event on release
  if(value == Gpio.HIGH) {
    press = Date.now();
    return;
  }

  const delta = Date.now() - press;
  press = undefined;

  if(delta > 3000) { // 3 seconds, long press
    ready = false;
    await reset();
    ready = true;
  } else {    
    if(++ screen == Object.keys(Screen).length) {
      screen = 0;
    }

    // if there is no weather alert, move to the next screen
    if(screen == Screen.ALARM && !values.alarm) {
      screen ++;
    }
  
    if(connected) {
      // save screen to MQTT topic with retain = true so we can get back to this screen next time
      client.publish('config/status', JSON.stringify({ screen: screen }), { retain: true });
    }
  }

  await rotate();
});

const blank = (width, pages) => {
  const buffer = new Array(width * pages);
  buffer.fill(0);

  return buffer;
}

/**
 * Prints a single value to the screen in a large (2 page) font with a given title and right margin.
 * The area from the left of the screen to where the value starts is cleared.
 */
const single = async (title, text, margin) => {
  await print(title, TextAlign.left, 0);

  const buffer = doubleup(grand9k.get(text));
  const offset = ssd1306.width() - buffer.length / 2 - margin;

  await ssd1306.display(blank(offset, 2), 0, 1, offset, 2);
  await ssd1306.display(buffer, offset, 1, buffer.length / 2, 2);  
}

const temperature = async (value) => {
  if(!ready) {
    return;
  }

  switch(screen) {
    case Screen.TEMPERATURE:
      await single('Temp.', value.toFixed(1) + ' ºC', 16);
      break;
    case Screen.WEATHER:
      // TODO: print value in WEATHER screen
      await print(value.toFixed(1) + 'ºC', TextAlign.RIGHT, 0);
      break;
  }
}

const pressure = async (value) => {
  if(ready && screen == Screen.PRESSURE) {
    await single('Pressure', value.toFixed(0) + ' hPa', 16);
    // TODO: print value in WEATHER screen
  }
}

const humidity = async (value) => {
  if(ready && screen == Screen.HUMIDITY) {
    await single('Humidity', value.toFixed(0) + ' %', 16);
    // TODO: print value in WEATHER screen
  }
}

const weather = async () => {
  if(ready) {
    await print('Temp.:', TextAlign.LEFT, 0);
    await print('Pressure:', TextAlign.LEFT, 1);
    await print('Humidity:', TextAlign.LEFT, 2);
    await print('Alarm:', TextAlign.LEFT, 3);
  }
}

const alarm = async (value, interrupt) => {
  if(!ready) {
    return;
  }
  
  // TODO: parse alert values
  // TODO: print value in WEATHER screen

  // only react to alerts greater than strong wind
  if(value < 0b00001000) {
    return;
  }
  
  if(interrupt) {
    ready = false;
    await ssd1306.clear();
  }

  // TODO: display weather alert on the screen
  console.log('Weather alert: 0b' + value.toString(2).padStart(8, 0));

  if(interrupt) {
    await sleep(10000);
    ready = true;
    
    await rotate(); // go back to original screen
  }
}

const voltage = async (value) => {
  if(ready && screen == Screen.VOLTAGE) {
    await single('Main', value.toFixed(2) + ' V', 16);
  }
}

const rotate = async () => {
  await ssd1306.clear();

  switch(screen) {
    case Screen.SPLASH:
      await splash();
      break;
    case Screen.TEMPERATURE:
      await temperature(values.temperature);
      break;
    case Screen.PRESSURE:
      await pressure(values.pressure);
      break;
    case Screen.HUMIDITY:
      await humidity(values.humidity);
      break;
    case Screen.WEATHER:
      await weather();
      break;
    case Screen.ALARM:
      await alarm(values.alarm);
      break;
    case Screen.VOLTAGE:
      await voltage(values.voltage);
      break;
  }
}

const doubleup = (buffer) => {
  const msb = new Array();
  const lsb = new Array();

  for(let i = 0; i < buffer.length; i ++) {
    const data = stretch(buffer[i]);

    msb.push(data[1]); // add twice to scale in width as well
    msb.push(data[1]);
    lsb.push(data[0]);
    lsb.push(data[0]);
  }

  return [...msb, ...lsb];
}

/**
 * Takes one byte and stretches it into a word. Useful to scale pixel fonts.
 * Example: 00110011 -> 0000111100001111
 *
 * Returns the two resulting bytes with the most significant bits in the first position of the array.
 */
const stretch = (byte) => {
  let result = 0b0;

  for(let i = 0; i < 8; i ++) {
    const bit = byte & (1 << i);
    result |= bit << (i + 1) | bit << i;
  }

  return [result >> 8, result & 0xff];
}

/**
 * Prints the given text to the specified page. Multiple calls can be made to write text to the same page
 * if the text is small enough and each text has different alignments.
 */
const print = async (text, align = TextAlign.LEFT, page = 0) => {
  const buffer = grand9k.get(text);

  let offset = 0;

  if(align == TextAlign.RIGHT) {
    offset = ssd1306.width() - buffer.length;
  }

  await ssd1306.display(buffer, offset, page, buffer.length, 1);
}

/**
 * Resets the display, this needs to be done on every startup
 */
const reset = async () => {
  await ssd1306.reset();
  await ssd1306.init(ssd1306.WIDTH, ssd1306.HEIGHT); // 128x32 is the default
  await ssd1306.clear(); // clears the display on start in case there was data in the display
}

const splash = async () => {
  await ssd1306.display(ssd1306.SPLASH, 16, 0, 32, 32 / 8);

  await print('Powered by', TextAlign.RIGHT, 0);
  await print('Node.JS', TextAlign.RIGHT, 1);
  await print(address(), TextAlign.RIGHT, 3);
}

/**
 * On system startup show a splash screen on the status display along with the IP address.
 * After 10 seconds switch to the last selected screen if there was one.
 */
const start = async () => {
  await reset();
  await splash();
  await sleep(10000);

  ready = true;

  if(screen) {
    await rotate();
  }
}

start();
