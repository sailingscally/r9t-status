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
const { WeatherAlert } = require('r9t-commons');

const os = require('os');
const mqtt = require('mqtt');

const grand9k = require('grand9k');
const ssd1306 = require('ssd1306');
const commons = require('r9t-commons');

const TextAlign = {
  RIGHT: 0b001,
  CENTER: 0b010,
  LEFT: 0b100
}

const Screen = {
  SPLASH: 0,
  TIME: 1, // TODO: add clock screen (what about timezones and DST - config?)
  TEMPERATURE: 2,
  PRESSURE: 3,
  HUMIDITY: 4,
  BAROGRAPH: 5,
  WEATHER: 6,
  ALARM: 7,
  VOLTAGE: 8
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
    case "weather/barograph":
      const data = JSON.parse(message);
      barograph(data);
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

let job = undefined;
let anim = 0;

const barograph = async (data) => {
  const axis = ssd1306.width() - 24 * 4;

  if(data) {
    clearInterval(job);
    
    // get the range of barometric pressure values
    const range = data.reduce((result, row) => {
      if(row.pressure > result.max) {
        result.max = row.pressure;
      }
      if(row.pressure < result.min) {
        result.min = row.pressure;
      }

      return result;
    }, { max: data[0].pressure, min: data[0].pressure });

    await print(range.max.toFixed(0), TextAlign.LEFT, 0);
    await print(range.min.toFixed(0), TextAlign.LEFT, 3);

    // calculate the multiplication factor so the range uses as much screen height as possible
    const factor = Math.floor(23 / (range.max - range.min));
    const floor = Math.floor(factor * range.min); // this is the minimum value that will print

    // calculate the adjusted true range and center it (small adjustment)
    let _true = Math.floor(factor * range.max) - Math.floor(factor * range.min);
    _true = Math.ceil((23 - _true) / 2);
    
    const buffer = new Array(24 * 4 * 3); // 3 pages

    for(let i = 0; i < data.length; i ++) {
      const shift = Math.floor(factor * data[i].pressure - floor) + _true;
      const binary = 0b100000000000000000000000 >> shift;
      
      // the lsb is at the top of the page (the code below prints a nice ASCII art barograph)
      // console.log(shift.toString().padStart(2, 0) + ' | 0b' + binary.toString(2).padStart(24, 0));

      buffer[i] = binary & 0xff;
      buffer[i + 24 * 4] = (binary >> 8) & 0xff;
      buffer[i + 24 * 4 * 2] = (binary >> 16) & 0xff;
    }

    await ssd1306.display(buffer, axis, 1, 24 * 4, 3);
  } else {
    await print('Barograph', TextAlign.CENTER, 0);    
    await ssd1306.display([0xff, 0xff, 0xff], axis - 1, 1, 1, 3);

    job = setInterval(async () => {
      await ssd1306.display([0b10000000, 0b00000001], anim ++, 1, 1, 2);
      if(anim == axis - 2) {
        anim = 0;
      }
    }, 100); // 100ms

    if(connected) {
      client.publish('storm/barograph', JSON.stringify({ fetch: true }));
    }
  }
}

const weather = async () => {
  if(ready) {
    await print('Temp.:', TextAlign.LEFT, 0);
    await print('Pressure:', TextAlign.LEFT, 1);
    await print('Humidity:', TextAlign.LEFT, 2);
    await print('Alarm:', TextAlign.LEFT, 3);

    // TODO: print previous values to the screen
  }
}

const alarm = async (value, interrupt) => {
  if(!ready) {
    return;
  }
  
  // TODO: print value in WEATHER screen
  // TODO: ignore interrups with the same or lower alert within the same hour

  // only react to interrupts to alerts greater than strong wind
  if(value < WeatherAlert.STRONG_WIND) {
    return;
  }
  
  if(interrupt) {
    ready = false;
    await ssd1306.clear();
  }

  // TODO: display weather alert on the screen
  console.log('Weather alert: 0b' + value.toString(2).padStart(8, 0));

  if(interrupt) {
    await commons.sleep(10000);
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
    case Screen.BAROGRAPH:
      await barograph();
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

  if(align == TextAlign.CENTER) {
    offset = Math.floor((ssd1306.width() - buffer.length) / 2);
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
  await commons.sleep(10000);

  ready = true;

  if(screen) {
    await rotate();
  }
}

start();
