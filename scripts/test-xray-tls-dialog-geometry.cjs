#!/usr/bin/env node
'use strict';
// Real Chromium regression for the full CSS cascade. Previously users.css
// matched ALL dialogs and forced XRAY STUDIO TLS into a 30rem action sheet.
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('./browser/node_modules/playwright');
const {panelStyles}=require('./ci/frontend-source.cjs');

(async()=>{
  const browser=await chromium.launch({
    headless:true,
    ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
    args:process.env.XMESH_CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]
  });
  try{
    for(const [width,height] of [[390,844],[768,1024],[1366,768],[1440,900],[1920,1080],[2560,1440]]){
      const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
      try{
        await page.setContent('<main id="xm-studio-v4"><select data-tool-inbound><option value="0">Main</option></select><textarea data-v="source"></textarea><button data-tool="tls">TLS</button></main>');
        await page.locator('[data-v="source"]').fill(JSON.stringify({
          inbounds:[{
            tag:'vless-main',port:443,protocol:'vless',
            streamSettings:{
              network:'xhttp',security:'tls',
              tlsSettings:{alpn:['h3','h2'],certificates:[],serverName:'vpn.example.org'}
            }
          }]
        }));
        // Use every production stylesheet, preserving import/cascade order.
        await page.addStyleTag({content:panelStyles()});
        await page.addScriptTag({path:path.resolve('frontend/js/features/xray-studio/xray-studio-tls-dialog.js')});
        await page.locator('[data-tool="tls"]').click();
        const dlg=page.locator('dialog.xm-tls-dialog[open]');
        await dlg.waitFor({state:'visible'});
        const metrics=await page.evaluate(()=>{
          const dialog=document.querySelector('dialog.xm-tls-dialog');
          const rect=node=>node.getBoundingClientRect();
          const outside=(node,outer)=>{
            const r=rect(node),o=rect(outer);
            return r.left<o.left-2||r.right>o.right+2;
          };
          const blocks=[...dialog.querySelectorAll('.xm-tls-version-grid,.xm-tls-alpn-grid,.xm-tls-identity-row')];
          const choices=[...dialog.querySelectorAll('.xm-tls-choice,.xm-tls-alpn')];
          return {
            dialog:rect(dialog).toJSON(),
            footer:rect(dialog.querySelector('.xm-tls-footer')).toJSON(),
            narrowChoices:choices.filter(node=>rect(node).width<48).length,
            outsideBlocks:blocks.filter(node=>outside(node,dialog)).length,
            overflowingShell:dialog.querySelector('.xm-tls-shell').scrollWidth > dialog.clientWidth+3,
            gridColumns:getComputedStyle(dialog.querySelector('.xm-tls-settings')).gridTemplateColumns
          };
        });
        const expected=width>=1600?Math.min(1380,width-64):width>=800?Math.min(1180,width-32):width<=760?width-16:width-32;
        assert(Math.abs(metrics.dialog.width-expected)<8,
          'TLS editor width '+width+'x'+height+': '+metrics.dialog.width+', expected '+expected);
        assert(metrics.dialog.x>=-2 && metrics.dialog.x+metrics.dialog.width<=width+2,
          'TLS editor escapes viewport at '+width+'x'+height);
        assert(metrics.footer.bottom<=height+2,
          'TLS action footer must stay visible at '+width+'x'+height);
        assert.equal(metrics.outsideBlocks,0,'TLS input blocks clipped at '+width+'x'+height);
        assert.equal(metrics.narrowChoices,0,'TLS options become unusably narrow at '+width+'x'+height);
        assert(!metrics.overflowingShell,'TLS shell has horizontal overflow at '+width+'x'+height);

        await dlg.locator('input[name="serverName"]').fill('secure.example.org');
        await dlg.locator('.xm-tls-apply').click();
        assert.equal(await page.locator('dialog.xm-tls-dialog').count(),0,
          'Submitting TLS closes only its own dialog');
        const saved=JSON.parse(await page.locator('[data-v="source"]').inputValue());
        assert.equal(saved.inbounds[0].streamSettings.tlsSettings.serverName,'secure.example.org',
          'Wide TLS dialog must preserve the working save action');
        console.log('TLS dialog: '+width+'x'+height+', width '+Math.round(metrics.dialog.width)+'px, body and footer OK');
      }finally{await page.close();}
    }
    console.log('Xray TLS modal desktop/mobile responsive geometry and save flow passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
