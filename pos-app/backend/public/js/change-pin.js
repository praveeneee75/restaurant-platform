async function changePin(){

const newPin = document.getElementById("newPin").value

const restaurantId = localStorage.getItem("restaurantId")

const user = JSON.parse(localStorage.getItem("user"))

if(!/^\d{6}$/.test(newPin)){

document.getElementById("msg").innerText =
"PIN must be 6 digits"

return

}

try{

const res = await fetch("/users/change-pin",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
restaurantId,
username:user.username,
newPin
})

})

const data = await res.json()

if(!data.success){

document.getElementById("msg").innerText =
data.message

return

}

document.getElementById("msg").innerText =
"PIN changed successfully"

setTimeout(()=>{

window.location.href="/login.html"

},1500)

}catch(err){

console.error(err)

document.getElementById("msg").innerText =
"Server error"

}

}
