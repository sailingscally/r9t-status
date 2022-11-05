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

const os = require('os');
const mqtt = require('mqtt');

const interfaces = os.networkInterfaces();

for(const name of Object.keys(interfaces)) {
  const ip = interfaces[name].find(net => net.internal == false && net.family == 'IPv4');

  if(ip != undefined) {
    console.log('IP: ' + ip.address);
  }
}

console.log(os.cpus());
console.log(os.totalmem());
console.log(os.freemem())

const client = mqtt.connect('mqtt://localhost:1883', {
  clientId: 'r9t-status'
});

client.on('connect', () => {
  console.log('Connected to MQTT broker.');

  client.options.reconnectPeriod = 1000;
  client.subscribe(['voltage/main', 'weather/+', 'alarm/weather']);
});

client.on('close', () => {
  if(connected) {
    console.log('Connection to MQTT broker lost.');
  }
});

client.on('message', (topic, message) => {
  switch(topic) {
    case 'voltage/main':
      console.log('Voltage [main]: ' + parseFloat(message).toFixed(2));
      break;
    case 'weather/temperature':
      console.log('Temperature: ' + parseFloat(message).toFixed(1) + 'º');
      break;
    case 'weather/pressure':
      console.log('Pressure: ' + parseFloat(message).toFixed(0) + 'hPa');
      break;
    case 'weather/humidity':
      console.log('Humidity: ' + parseFloat(message).toFixed(0) + '%');
      break;
    case 'alarm/weather':
      console.log('Weather alert: 0b' + message); // TODO: parse this value and give the appropriate alerts
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
