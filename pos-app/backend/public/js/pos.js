const restaurantId = localStorage.getItem("restaurantId")

let cart = []
let categories = []
let items = []

async function loadCategories(){

const res = await fetch(`/categories/list?restaurantId=${restaurantId}`)
const data = await res.json()

categories = data.categories

const container = document.getElementById("categories")
container.innerHTML=""

categories.forEach(c=>{

const div=document.createElement("div")
div.className="category"
div.innerText=c.name

div.onclick=()=>loadItems(c.id)

container.appendChild(div)

})

}


async function loadItems(categoryId){

const res = await fetch(`/items/list?restaurantId=${restaurantId}`)
const data = await res.json()

items = data.items.filter(i=>i.category_id===categoryId)

const container = document.getElementById("items")
container.innerHTML=""

items.forEach(i=>{

const div=document.createElement("div")
div.className="item"

div.innerHTML=`
<b>${i.name}</b><br>
₹${i.price}
`

div.onclick=()=>addToCart(i)

container.appendChild(div)

})

}


function addToCart(item){

const existing = cart.find(c=>c.id===item.id)

if(existing){

existing.qty++

}else{

cart.push({...item,qty:1})

}

renderCart()

}


function renderCart(){

const container=document.getElementById("cartItems")
container.innerHTML=""

let total=0

cart.forEach(c=>{

const row=document.createElement("div")

row.innerText=`${c.qty} x ${c.name}`

container.appendChild(row)

total+=c.price*c.qty

})

document.getElementById("total").innerText=`Total: ₹${total}`

}


async function checkout(){

if(cart.length===0){

alert("Cart empty")
return

}

const user=JSON.parse(localStorage.getItem("user"))

const res = await fetch("/orders/create",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({

restaurantId,
tableNumber:null,
items:cart,
createdBy:user.name

})

})

const data=await res.json()

if(!data.success){

alert(data.message)
return

}

alert("Order Created")

cart=[]
renderCart()

}

loadCategories()