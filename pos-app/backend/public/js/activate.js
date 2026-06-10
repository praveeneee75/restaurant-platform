async function activate(){

const restaurantId =
document.getElementById("restaurantId").value

const licenseKey =
document.getElementById("licenseKey").value

const res = await fetch("/activate",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
restaurantId,
licenseKey
})

})

const data = await res.json()

if(!data.success){

document.getElementById("msg").innerText =
data.message

return
}

// store restaurant locally
localStorage.setItem("restaurantId",restaurantId)

document.getElementById("msg").innerText =
"POS Activated Successfully"

}