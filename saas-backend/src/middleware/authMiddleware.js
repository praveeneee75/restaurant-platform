const jwt = require("jsonwebtoken")
const { config } = require('../config');

module.exports = function(req,res,next){

const header = req.headers.authorization

if(!header){

return res.status(401).json({
success:false,
message:"Invalid token"
})

}

const token = header.split(" ")[1]

try{

const decoded = jwt.verify(token, config.jwtSecret)

req.user = decoded

next()

}catch(err){

return res.status(401).json({
success:false,
message:"Invalid token"
})

}

}
