import scrapy
from scrapy import FormRequest


class loginDoodoo(scrapy.Spider):
    name = "LoginDoodoo"
    allowed_domains = ["doodoo520.com"]
    start_urls = ["https://www.doodoo520.com/admin/login"]

    def parse(self, response):
        csrf_token = response.xpath("//*[@name = 'csrf_token']/@value").get()
        yield FormRequest.from_response(
            response,
            formdata={
                "csrf_token": csrf_token,
                "username": "jiaenkoh45@gmail.com",
                "password": "01110609869",
            },
            callback=self.parse_after_login,
        )

    def parse_after_login(self, response):
        
        status = response.css('span.nav-text::text').get()
        if status:
            statusTrimmed = status.strip()
            print(statusTrimmed)
        else:
            self.logger.warning("Status text not found")

        orderPage = response.xpath("//div[@id='sidebar']/ul/li[8]/a/@href").get()
        if orderPage:
            print("Acessing Order page now!")
            yield response.follow(orderPage, callback=self.enter_order_id)
        else:
            print("Order page link broken")

    def enter_order_id(self, response):
        invoiceID = input("Enter customer order id:")

        yield FormRequest.from_response(
            response,
            formnumber=1,
            formdata={"order_id": invoiceID},
        )





