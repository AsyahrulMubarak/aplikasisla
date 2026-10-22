// Read tested release sources while retaining each test's fixture dependencies.
const fs=require('node:fs'),path=require('node:path');
const sourceRoot=path.resolve(__dirname,'..'),releaseRoot=process.env.SLA_TEST_RELEASE_ROOT;
if(releaseRoot){const original=fs.readFileSync;fs.readFileSync=function(filename,...args){if(typeof filename==='string'){const absolute=path.resolve(filename),relative=path.relative(sourceRoot,absolute),runtime=/^(?:[^\\/]+\.(?:html|js|css)|supabase[\\/])/.test(relative);if(runtime&&!relative.startsWith('..')&&!path.isAbsolute(relative)){const replacement=path.join(releaseRoot,relative);if(fs.existsSync(replacement)&&fs.statSync(replacement).isFile())filename=replacement;}}return original.call(this,filename,...args);};}
