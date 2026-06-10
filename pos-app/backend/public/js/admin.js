const restaurantId = localStorage.getItem("restaurantId")

async function loadKitchens(){

const res = await fetch(`/kitchens/list?restaurantId=${restaurantId}`)
const data = await res.json()

const select = document.getElementById("kitchenSelect")
select.innerHTML=""

data.kitchens.forEach(k=>{

const option=document.createElement("option")
option.value=k.id
option.text=k.name

select.appendChild(option)

})

}


async function loadCategories(){

const res = await fetch(`/categories/list?restaurantId=${restaurantId}`)
const data = await res.json()

const select = document.getElementById("categorySelect")
select.innerHTML=""

data.categories.forEach(c=>{

const option=document.createElement("option")
option.value=c.id
option.text=c.name

select.appendChild(option)

})

}


async function loadItems(){

const res = await fetch(`/items/list?restaurantId=${restaurantId}`)
const data = await res.json()

const tbody=document.querySelector("#itemTable tbody")
tbody.innerHTML=""

data.items.forEach(i=>{

const row=document.createElement("tr")

row.innerHTML=`
<td>${i.name}</td>
<td>${i.category}</td>
<td>${i.price}</td>
`

tbody.appendChild(row)

})

}


async function createKitchen(){

const name=document.getElementById("kitchenName").value

await fetch("/kitchens/create",{

method:"POST",
headers:{'Content-Type':'application/json'},

body:JSON.stringify({
restaurantId,
creatorRole:"OWNER",
name
})

})

loadKitchens()

}


async function createCategory(){

const name=document.getElementById("categoryName").value
const kitchenId=document.getElementById("kitchenSelect").value

await fetch("/categories/create",{

method:"POST",
headers:{'Content-Type':'application/json'},

body:JSON.stringify({
restaurantId,
creatorRole:"OWNER",
name,
kitchenId
})

})

loadCategories()

}


async function createItem(){

const restaurantId = localStorage.getItem("restaurantId")

const name = document.getElementById("itemName").value
const price = document.getElementById("itemPrice").value
const categoryId = document.getElementById("itemCategory").value

try{

const res = await fetch("/items/create",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({
restaurantId,
creatorRole:"OWNER",
name,
categoryId,
price
})
})

const data = await res.json()

if(data.success){

alert("✅ Item created successfully")

loadItems()

}else{

alert("❌ "+data.message)

}

}catch(err){

alert("❌ Server error")

}

}

async function loadItems(){

const restaurantId = localStorage.getItem("restaurantId")

const res = await fetch(`/items/list?restaurantId=${restaurantId}`)

const data = await res.json()

const table = document.getElementById("itemsTable")

table.innerHTML=""

data.items.forEach(i=>{

table.innerHTML+=`
<tr>

<td>${i.id}</td>

<td>${i.name}</td>

<td>${i.price}</td>

<td>${i.category}</td>

<td>

<button onclick="editItem(${i.id},'${i.name}',${i.price})">
Edit
</button>

<button onclick="deleteItem(${i.id})">
Delete
</button>

</td>

</tr>
`

})

}

async function deleteItem(id){

if(!confirm("Delete this item?")) return

const restaurantId = localStorage.getItem("restaurantId")

const res = await fetch("/items/delete",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
restaurantId,
itemId:id
})

})

const data = await res.json()

if(data.success){

alert("Item deleted")

loadItems()

}else{

alert(data.message)

}

}


async function editItem(id,name,price){

const newName = prompt("Item name",name)
const newPrice = prompt("Price",price)

if(!newName || !newPrice) return

const restaurantId = localStorage.getItem("restaurantId")

const res = await fetch("/items/update",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
restaurantId,
itemId:id,
name:newName,
price:newPrice
})

})

const data = await res.json()

if(data.success){

alert("Item updated")

loadItems()

}else{

alert(data.message)

}

}


loadKitchens()
loadCategories()
loadItems()