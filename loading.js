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

const grand9k = require('grand9k');
const ssd1306 = require('ssd1306');
const commons = require('r9t-commons');

const readline = require('readline');

let job = undefined;
let anim = 0;

const stdin = readline.createInterface({
  input: process.stdin,
  terminal: false
});

stdin.on('line', async (line) => {
  clearInterval(job);
  await ssd1306.clear();
  
  console.log('Done!');
  process.exit();
});

/**
 * Draws a rectangle 64 pixels wide in the center of the display (on the 3rd page).
 * 0-31 is margin, 32-95 is the actual rectangle and 96 to 127 is margin.
 */
const rectangle = async () => {
  const buffer = new Array(ssd1306.width() / 2);
  buffer.fill(0b10000001, 1, 63); // top and bottom horizontal lines
  buffer[0] = 0xff; // left vertical line
  buffer[63] = 0xff; // right vertical line
    
  await ssd1306.display(buffer, 32, 2, 64, 1);  
}

const animate = async () => {
  if(anim == 60) {
    // clear and start over
    await rectangle();
    anim = 0;
  }

  ssd1306.display([0b10111101], 34 + anim ++, 2, 1, 1); // starts in column 34
}

/**
 * Writes the title to the screen (top and centered).
 */
const title = async (title) => {
  const text = grand9k.get(title);
  const offset = Math.floor((ssd1306.width() - text.length) / 2);

  await ssd1306.display(text, offset, 0, text.length, 1);  
}

/**
 * Resets the display, this needs to be done on every startup
 */
const reset = async () => {
  await ssd1306.reset();
  await ssd1306.init(ssd1306.WIDTH, ssd1306.HEIGHT); // 128x32 is the default
  await ssd1306.clear(); // clears the display on start in case there was data in the display
}

const start = async () => {
  await reset();
  await title('Barograph');
  await rectangle();

  // start the loading animation
  job = setInterval(() => {
    animate();
  }, 50); // 100ms
  
  console.log('Press return to exit...');
}

start();
