# Example Use

```js
const axios = require('axios')

let response = await axios.post('https://mxmxk.herokuapp.com/imagetopdf', {
  images: ['https://i.waifu.pics/dQ8bv0m.png', 'https://i.waifu.pics/G3tcTFi.jpg']
})

return response.data // { result: 'url_download' }
``` 
