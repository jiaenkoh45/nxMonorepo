import scrapy
from scrapy import FormRequest
from scrapy.shell import inspect_response



class loginBStall(scrapy.Spider):
    name = "LoginBStall"
    allowed_domains = ["b2b.fashionindex.com.my"]
    start_urls = ["https://b2b.fashionindex.com.my/login"]

    def parse(self, response):
        csrf_token = response.xpath("//*[@name = 'csrf_token']/@value").get()
        yield FormRequest.from_response(
            response,
            formdata={
                "csrf_token": csrf_token,
                "email": "doodoolive777@gmail.com",
                "password": "Doodoo520",
            },
            callback=self.parse_after_login,
        )

    def parse_after_login(self, response):
        status = response.xpath("//form/button/text()").get()
        statusTrimmed = status.strip()

        if statusTrimmed == "Log Out":
            print("Login succeed")
        else:
            print("Login failed")

        orderPage = response.xpath("//nav/a[2]/@href").get()
        if orderPage:
            print("Acessing Order page now!")
            yield response.follow(orderPage, callback=self.enter_invoice_no)
        else:
            print("Order page link broken")

    def enter_invoice_no(self, response):
        invoiceID = input("Enter invoice no:")

        yield FormRequest.from_response(
            response,
            formnumber=1,
            formdata={"order_id": invoiceID},
            callback=self.get_order_link,
        )

    def get_order_link(self, response):
        for order in response.xpath("//div[@class='border rounded order-row']//div/a"):
            tracking = order.xpath('./text()').get()
            if not tracking or not tracking.strip():
                continue
        
            order_link = order.xpath('./@href').get()
        
            yield response.follow(
                order_link,
                callback=self.get_order_details,
                meta={'orderLink': order_link, 'trackingNo': tracking.strip()}
            )

    def get_order_details(self, response):
        # inspect_response(response, self)

    # Get all text nodes first
        shipping = response.xpath("//div//div[2]/a/@href").getall()

        product_rows = response.xpath(
            '//div[contains(@class,"divide-y")]/div[contains(@class,"flex")]'
        )

        for row in product_rows:
            texts = row.xpath('.//text()[normalize-space()]').getall()
            texts = [' '.join(t.split()) for t in texts]
            yield {
                'orderLink': response.meta['orderLink'],
                'trackingNo': response.meta['trackingNo'],
                'shippingOrder': shipping,
                'productName': texts[0] if len(texts) > 0 else None,
                'productCode': texts[1] if len(texts) > 1 else None,
                'priceValue': texts[3] if len(texts) > 3 else None,
                'quantityValue': texts[5] if len(texts) > 5 else None,
                'subtotalValue': texts[7] if len(texts) > 7 else None,
            }        

    
         
    



