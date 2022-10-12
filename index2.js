
// !store
function createStore(reducer){
    let state       = reducer(undefined, {}) //стартовая инициализация состояния, запуск редьюсера со state === undefined
    let cbs         = []                     //массив подписчиков
    
    const getState  = () => state            //функция, возвращающая переменную из замыкания
    const subscribe = cb => (cbs.push(cb),   //запоминаем подписчиков в массиве
                             () => cbs = cbs.filter(c => c !== cb)) //возвращаем функцию unsubscribe, которая удаляет подписчика из списка
                             
    const dispatch  = action => { 
        if (typeof action === 'function'){ //если action - не объект, а функция
            return action(dispatch, getState) //запускаем эту функцию и даем ей dispatch и getState для работы
        }
        const newState = reducer(state, action) //пробуем запустить редьюсер
        if (newState !== state){ //проверяем, смог ли редьюсер обработать action
            state = newState //если смог, то обновляем state 
            for (let cb of cbs)  cb() //и запускаем подписчиков
        }
    }
    
    return {
        getState, //добавление функции getState в результирующий объект
        dispatch,
        subscribe //добавление subscribe в объект
    }
}


// ! decoding token
function jwtDecode(token){
    try {
        return JSON.parse(atob(token.split('.')[1]))
    }
    catch(e){
    }
}


// ! reducers
function authReducer(state, {type, token}){
    if(state === undefined){
        if(localStorage.authToken){
            token = localStorage.authToken
            type = 'AUTH_LOGIN'
        }
        else{
            type = 'AUTH_LOGOUT'
        } 
    }
    if(type === 'AUTH_LOGIN'){
        state = jwtDecode(token)
        localStorage.authToken = token
    }
    if(type === 'AUTH_LOGOUT'){
        localStorage.authToken = ''
        state = {}
    }
    return state || {}
}

function promiseReducer(state={}, {type, name, status, payload, error}){
    if (type === 'PROMISE'){
        return {
            ...state,
            [name]:{status, payload, error}
        }
    }
    return state
}


function cartReducer(state={}, {type, good, count=1}){
    if (type === 'CART_ADD'){
        return { 
            ...state, 
            [good._id]: {count: (state[good._id]?.count || 0) + count, good:good}
        }
    }
    if (type === 'CART_CHANGE'){
        return { 
            ...state, 
            [good._id]: {count, good}
        }
    }
    if (type === 'CART_DELETE'){
        delete state[good._id]
        return { 
            ...state,    
        }
    }
    if (type === 'CART_CLEAR'){
        return {}
    }
    return state
}

const actionCartAdd    = (good, count=1) => ({type: 'CART_ADD', good, count})
const actionCartChange = (good, count=1) => ({type: 'CART_CHANGE', good, count})
const actionCartDelete = (good)          => ({type: 'CART_DELETE', good})
const actionCartClear  = ()              => ({type: 'CART_CLEAR'})

function combineReducers(reducers){ //пачку редьюсеров как объект {auth: authReducer, promise: promiseReducer}
    function combinedReducer(combinedState={}, action){ //combinedState - типа {auth: {...}, promise: {....}}
        const newCombinedState = {}
        for (const [reducerName, reducer] of Object.entries(reducers)){
            const newSubState = reducer(combinedState[reducerName], action)
            if (newSubState !== combinedState[reducerName]){
                newCombinedState[reducerName] = newSubState
            }
        }
        if (Object.keys(newCombinedState).length === 0){
            return combinedState
        }
        return {...combinedState, ...newCombinedState}
    }

    return combinedReducer //нам возвращают один редьюсер, который имеет стейт вида {auth: {...стейт authReducer-а}, promise: {...стейт promiseReducer-а}}
}

 const store = createStore(combineReducers({promise: promiseReducer, auth: authReducer, cart:cartReducer}))
 store.subscribe(() => console.log(store.getState()))
 
// ! GQL
const getGQL = url =>
    (query, variables) => fetch(url, {
        method: 'POST',
        headers: {
            "Content-Type": "application/json",
            ...(localStorage.authToken ? {"Authorization": "Bearer " + localStorage.authToken} : {})
        },
        body: JSON.stringify({query, variables})
    }).then(res => res.json())
        .then(data => {
            if (data.data){
                return Object.values(data.data)[0] 
            } 
            else throw new Error(JSON.stringify(data.errors))
        })

const backendURL = 'http://shop-roles.node.ed.asmer.org.ua/graphql'

const gql = getGQL(backendURL + '/graphql')

// !PROMISE
const actionPromise = (name, promise) =>
    async dispatch => {
        dispatch(actionPending(name))
        try {
            let payload = await promise
            dispatch(actionFulfilled(name, payload))
            return payload
        }
        catch(error){
            dispatch(actionRejected(name, error))
        }
    }

const actionPending             = name => ({type:'PROMISE',name, status: 'PENDING'})
const actionFulfilled = (name,payload) => ({type:'PROMISE',name, status: 'FULFILLED', payload})
const actionRejected  = (name,error)   => ({type:'PROMISE',name, status: 'REJECTED', error})

// ! ACTIONS
const actionFullRegister = (login, password) => 
    actionPromise('fullRegister', gql(`mutation UserUpsert($login: String, $password: String){UserUpsert(user: {login:$login,password:$password}){_id}}`, {login: login, password:password}))


const actionAuthLogin = (token) =>
    (dispatch, getState) => {
        const oldState = getState()
        dispatch({type: 'AUTH_LOGIN', token})
        const newState = getState()
        if (oldState !== newState)
            localStorage.authToken = token
    }


const actionFullLogin = (login, password) =>  //вход 
actionPromise('fullLogin', gql(`query login($login:String,$password:String){login(login:$login,password:$password)}`, {login: login, password:password}))


const actionAuthLogout = () => 
    dispatch => {
        dispatch({type: 'AUTH_LOGOUT'})
        localStorage.removeItem('authToken')
    }

const orderFind = () =>  //история заказов
actionPromise('orderFind', gql(`query orderFind{
    OrderFind(query: "[{}]"){
        _id createdAt total orderGoods {_id price count good{name price images{url}}}
    }
}`, {q: JSON.stringify([{}])}))

const actionAddOrder = (cart) =>  //оформ. заказа
actionPromise('actionAddOrder', gql(`mutation newOrder($cart: [OrderGoodInput])
{OrderUpsert(order: {orderGoods: $cart})
{_id total}}`, {cart: cart}))

const actionRootCats = () => 
    actionPromise('rootCats', gql(`query {
        CategoryFind(query: "[{\\"parent\\":null}]"){
            _id name
            
        }
    }`))

const actionCatById = (_id) =>  
    actionPromise('catById', gql(`query catById($q: String){
        CategoryFindOne(query: $q){
            _id name goods {
                _id name price images {
                    url
                }
                
            }
            subCategories{_id name}
            
        }
    }`, {q: JSON.stringify([{_id}])}))

const actionGoodById = (_id) =>  
    actionPromise('goodById', gql(`query goodById($q: String){
        GoodFindOne(query: $q){
            _id name price description images {
                url
            }
        }
    }`, {q: JSON.stringify([{_id}])}))


store.dispatch(actionRootCats())


// !SUBSCRIBE

store.subscribe(() => {
    
    const {rootCats} = (store.getState()).promise 
    if (rootCats?.payload){
        aside.innerHTML = `<li class="list-group-item"><b>Категории</b></li>`

        for (const {_id, name} of rootCats?.payload){
            const categories      = document.createElement('li')
            categories.innerHTML  = `<a href='#/category/${_id}'>${name}</a>`
            categories.style = ' padding-left: 30px ; '
         
            aside.append(categories)
        }
    }
})


store.subscribe(() => {
    const {catById} = (store.getState()).promise 
    const [,route, _id] = location.hash.split('/')
    if (catById?.payload && route === 'category'){

        main.innerHTML = ``
        const {name} = catById.payload
        
        const card      = document.createElement('div')
        card.style     = 'height: auto;width: 100%;border-style: groove;border-color: #ced4da17;padding: 10px;border-radius: 10px;margin: 5px;' 
        card.innerHTML = `<h4><b>${name}</b></h4><br>`
        
        if(catById.payload.subCategories){
            for (const {_id, name} of catById.payload?.subCategories){
                card.innerHTML +=`<a href='#/category/${_id}' class='subcategories'>${name}</a>`
            }
        }

        main.append(card)
        for (const {_id, name, price, images} of catById.payload?.goods){
            const card      = document.createElement('div')
            card.style     = 'height: auto;width: 30%;border-style: groove;border-color: #ced4da17;padding: 10px;border-radius: 10px;margin: 5px; display: flex ; flex-direction: column ; justify-content: space-between' 
            card.innerHTML = `<h5><b>${name}</b></h5>
                              <img src="http://shop-roles.node.ed.asmer.org.ua/${images[0].url}" style="max-width: 100%; max-height: 300px;"/><br>
                              <strong>Цена: ${price} грн.</strong><br><br>
                              <a class="" style="width: 100%;" href='#/good/${_id}'>Подробнее</a><br><br>`
            let button = document.createElement('button')
            button.innerText = 'Купить' 
            button.className = 'btn-buy'
            button.style = 'width: 100%; font-family: Impact; letter-spacing : 1px'
            button.onclick = async () => {
                await store.dispatch(actionCartAdd({_id: _id, name: name, price: price, images: images})) 
                console.log('tap')
            }
            card.append(button)
            main.append(card)
        }
    }
})

store.subscribe(() => {
    const {goodById} = (store.getState()).promise 
    const [,route, _id] = location.hash.split('/')
    if (goodById?.payload && route === 'good'){
        const {name,description,images,price} = goodById.payload
        main.innerHTML = `<h1>${name}</h1>`
        
        const card      = document.createElement('div')
        card.innerHTML = `<img src="http://shop-roles.node.ed.asmer.org.ua/${images[0].url}" /><br>
                          <b>Цена: ${price} грн.</b><br>
                          <p><b>Описание:</b> ${description}</p>`
        main.append(card)
        
    }
})

store.subscribe(() => {
    const {orderFind} = (store.getState()).promise 
    const [,route, _id] = location.hash.split('/')
    
    if (orderFind?.payload && route === 'orderFind'){
        main.innerHTML='<h1>История заказов</h1>'

        for (const {_id, createdAt, total,orderGoods} of orderFind.payload.reverse()){
            const card      = document.createElement('div')
            card.style     = 'width: 100%;border-style: groove;border-color: #ced4da17;padding: 10px;border-radius: 10px;margin: 5px;' 
            card.innerHTML = `<h3>Заказ: ${createdAt}</h3>`
            for (const {count, good} of orderGoods){2
                const divGood      = document.createElement('div')
                divGood.style= "display:flex;margin-bottom: 20px;"
                
                divGood.innerHTML += `<div>Товар: <b>${good.name}</b><br> Цена: <b>${good.price} грн.</b><br> Количество: <b>${count} шт.</b></b></div><img style="max-width: 80px;margin-right: 20px;display: block;margin-left: auto;" src="http://shop-roles.node.ed.asmer.org.ua/${good.images[0].url}"/><br><br>`
                card.append(divGood)
            }
            card.innerHTML += 'Дата: <b>'+new Date(+createdAt).toLocaleString().replace(/\//g, '.')+'</b>'
            card.innerHTML += `<br>Всего: <b style="color:red;">${total} грн.</b>`
            main.append(card)
        }
    }
})

// !WINDOW

function display(){
    let token = localStorage.authToken
    if(token){
        form_yes.style.display = 'block'
       form_no.style.display = 'none'
        UserNick.innerText=JSON.parse(window.atob(localStorage.authToken.split('.')[1])).sub.login
    }else{
        form_yes.style.display = 'none'
       form_no.style.display = 'block'
    }   
}
display()

window.onhashchange = () => {
    const [, route, _id] = location.hash.split('/')
    mainContainer.scrollTo(0,0);

    const routes = {
        category(){
            store.dispatch(actionCatById(_id))
        },
        good(){ 
            store.dispatch(actionGoodById(_id))
        },
        login(){

            main.innerHTML = ''
            let form = document.createElement('div')
            let div = document.createElement('div')

            div.innerHTML += `<h1>Вход</h1>`
            let inputLogin = document.createElement('input')
            inputLogin.placeholder="Login"
            inputLogin.name = "login"
            div.append(inputLogin)

            form.append(div)

            let div2 = document.createElement('div')
            div.style.display = 'flex'
            div.style.flexDirection = 'column'

            let inputPassword = document.createElement('input')
            inputPassword.placeholder = "Password"
            inputPassword.name = "password"

            
            div2.append(inputPassword)
            
            form.append(div2)

            let button = document.createElement('button')
            button.innerText="Войти"
            button.style.padding = '15px 35px'
            button.style.marginTop = '20px'
            button.style.backgroundColor = 'yellowgreen'
            button.style.textTransform = 'uppercase'
            button.style.fontFamily = 'Impact'
            button.style.fontSize = '15px'
            
            button.onclick =  async () => {
                
                let tokenPromise = async () => await store.dispatch(actionFullLogin(inputLogin.value, inputPassword.value))
                let token = await tokenPromise()
                
                if(token!==null){
                    store.dispatch(actionAuthLogin(token))
                    console.log(token)
                    display()
                    document.location.href = "#/orderFind";
                }
                else{
                    inputLogin.value = ''
                    inputPassword.value = ''
                    alert("Введен неверный логин или пароль !")
                    store.dispatch(actionAuthLogout())
                }
            }

            form.append(button)
            main.append(form)

        },
        register(){
            main.innerHTML = ''
            let form = document.createElement('div')
            let div = document.createElement('div')

            div.innerHTML += `<h1>Регистрация</h1>`
            let inputLogin = document.createElement('input')
            inputLogin.placeholder="Login"
            div.append(inputLogin)

            form.append(div)

            let div2 = document.createElement('div')

            let inputPassword = document.createElement('input')
            inputPassword.placeholder="Password"
            
            div2.append(inputPassword)
            
            form.append(div2)

            let button = document.createElement('button')
            button.innerText="Зарегистрироваться"
            button.style.padding = '15px 35px'
            button.style.marginTop = '20px'
            button.style.backgroundColor = 'yellowgreen'
            button.style.textTransform = 'uppercase'
            button.style.fontFamily = 'Impact'
            button.style.fontSize = '15px'


            let textAlert = document.createElement('div')
            let textAlert2 = document.createElement('div')



            let putInText = "Введите данные!"
            let userAlready = "Пользователь с таким логином уже зарегистрирован!"
            textAlert.append(userAlready)
            textAlert2.append(putInText)

            textAlert2.style = 'display : none; color : red'
            textAlert.style = 'display : none; color : red'
            

            button.onclick =  async () => {
                let register = await store.dispatch(actionFullRegister(inputLogin.value, inputPassword.value))
                let tokenPromise = async () => await store.dispatch(actionFullLogin(inputLogin.value, inputPassword.value))

                if(inputLogin.value == '' || inputPassword.value == ''){
                    textAlert2.style.display = 'block'

                }else{
                    if(register !==null){
                        let token = await tokenPromise()
                        store.dispatch(actionAuthLogin(token))
                        console.log(token)
                        display()
                        document.location.href = "#/orderFind";

                    }else{
                    textAlert.style.display = 'block'
                    textAlert2.style.display = 'none'
                    }
                }

            }
            form.append(textAlert , textAlert2)
            form.append(button)
            main.append(form)
        },
        orderFind(){ 
            store.dispatch(orderFind())
        },
        car(){ 
                        main.innerHTML = '<h1>Корзина</h1>'
                        for (const [_id, obj] of Object.entries(store.getState().cart)){
                            const card      = document.createElement('div')
                            card.style     = 'width: 33.33%;border-style: groove;border-color: #ced4da17;padding: 10px;border-radius: 10px;margin: 5px;display: flex; flex-direction: column ; align-items: center ; justify-content: space-between' 
                            
                            const {count, good} = obj
                                
                            card.innerHTML += `Товар: <b>${good.name}</b> <br><img src="http://shop-roles.node.ed.asmer.org.ua/${good.images[0].url}" style="width: 100px"/> <br> Цена: <b>${good.price} грн.</b><br><br>`
            
                            const calculation = document.createElement('div')
            
                            const buttonAdd = document.createElement('button')
                            buttonAdd.innerHTML = '+'
                            buttonAdd.style.width = '35px'
                            buttonAdd.onclick = async () => {
                                inputCount.value = +inputCount.value + 1 
                                await store.dispatch(actionCartChange({_id: _id, name: good.name, price: good.price, images: good.images}, +inputCount.value)) 

                                cardTotal.innerHTML = `<br>Всего: <b style="color:red;">${goodPrice()} грн.</b><br>`
                            }
                            calculation.append(buttonAdd)
            
                            const inputCount = document.createElement('input')
                            inputCount.value = +count
                            inputCount.disabled = 'disabled'
                            inputCount.className = 'inputCount'
                            calculation.append(inputCount)
            
                            const buttonLess = document.createElement('button')
                            buttonLess.innerHTML = '-'
                            buttonLess.style.width = '35px'
                            buttonLess.onclick = async () => {
                                if((+inputCount.value)>1){
                                    inputCount.value = +inputCount.value - 1 
                                    await store.dispatch(actionCartChange({_id: _id, name: good.name, price: good.price, images: good.images}, +inputCount.value)) 

                                    cardTotal.innerHTML = `<br>Всего: <b style="color:red;">${goodPrice()} грн.</b><br>`
                                }
                                 
                            }
              
                            calculation.append(buttonLess)
            
                            const buttonDelete = document.createElement('button')
                            buttonDelete.innerText = 'Удалить'
                            buttonDelete.className = 'buttonDelete'
                            buttonDelete.onclick = async () => {
                                await store.dispatch(actionCartDelete({_id: _id, name: good.name, price: good.price, images: good.images})) 

                                card.style.display = 'none'
                                cardTotal.innerHTML = `<br>Всего: <b style="color:red;">${goodPrice()} грн.</b><br>`
                            }
                            card.append(calculation)
                            card.append(buttonDelete)
                            main.append(card)
                        }
                        const cardTotalDiv      = document.createElement('div')
                        const cardTotal      = document.createElement('div')
                        
                        cardTotalDiv.style = 'position : absolute; display : flex;right : 50px; bottom: 0px'
                        cardTotal.innerHTML = `<br>Всего: <b style="color:red;">${goodPrice()} грн.</b>`
                        
                        cardTotalDiv.append(cardTotal)
            
                        if(localStorage.authToken!=''){
                            const button      = document.createElement('button')
                            button.innerHTML += 'ЗАКАЗАТЬ'
                            button.style = ' background-color : yellowgreen; font-family: Impact; font-size : 40px'

                            button.onclick =  async () => {
                                await store.dispatch(actionAddOrder(Object.entries(store.getState().cart).map(([_id, count]) => ({count:count.count,good:{_id}}))));
                                await store.dispatch(actionCartClear());
                                document.location.href = "#/orderFind";
                            } 
                            button.className = 'btn btn-primary'
                            cardTotalDiv.append(button)
            
                        }
                        
                        main.append(cardTotalDiv)
                    

        }    
    }
    if (route in routes)
        routes[route]()
}
window.onhashchange()



function goodPrice(){
    return Object.entries(store.getState().cart).map(i=>x+=i[1].count*i[1].good.price, x=0).reverse()[0] || 0
}



