# Example Use

```js
const axios = require('axios')

let response = await axios.post('https://ripp-api.herokuapp.com/imagetopdf', {
  images: ['https://i.waifu.pics/dQ8bv0m.png', 'https://i.waifu.pics/G3tcTFi.jpg']
}, {
  responseType: 'arraybuffer'
})

return Buffer.from(response.data)
``` 
