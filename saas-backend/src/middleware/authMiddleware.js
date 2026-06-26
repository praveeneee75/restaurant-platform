const jwt = require("jsonwebtoken")
const { config } = require('../config');
const { isTokenRevoked, tokenFromRequest } = require('../utils/tokenSessions');

module.exports = async function(req,res,next){

const header = req.headers.authorization

if(!header){

return res.status(401).json({
success:false,
message:"Invalid token"
})

}

const token = tokenFromRequest(req)

try{

const decoded = jwt.verify(token, config.jwtSecret)
if (await isTokenRevoked(token)) {
return res.status(401).json({
success:false,
message:"Session expired"
})
}

req.user = decoded

next()

}catch(err){

return res.status(401).json({
success:false,
message:"Invalid token"
})

}

}
