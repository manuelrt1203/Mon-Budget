import { createBankHandler } from '../../server/app.js';
import { configuration } from '../../server/config.js';
let handler;
export default async function bank(req,res){
  try{
    handler ||= createBankHandler(configuration());
    return await handler(req,res);
  }catch{
    res.setHeader('Cache-Control','no-store');
    res.statusCode=503;res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify({error:'La configuration du serveur bancaire est incomplète ou invalide.'}));
  }
}
