var miio = require('miio');
var outputSignal = require("./packages/acSignal_handle");
var Accessory, Service, Characteristic;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-mi-acpartner', 'XiaoMiAcPartner', XiaoMiAcPartner);
}

function XiaoMiAcPartner(log, config) {
    if(null == config) {
        return;
    }

    //Init
    var that = this;

    this.log = log;
    this.name = config.name || "AC Partner";
    this.token = config.token;
    this.ip = config.ip;
    this.Active = Characteristic.Active.INACTIVE;
    this.CurrentHeaterCoolerState = Characteristic.CurrentHeaterCoolerState.INACTIVE;
    this.TargetHeaterCoolerState = Characteristic.TargetHeaterCoolerState.COOL;
    this.RotationSpeed = 1;
    this.SwingMode = Characteristic.SwingMode.SWING_DISABLED;
    this.CurrentTemperature = 0;
    this.CurrentRelativeHumidity = 0;
    this.AcModel = null;

    //Optional
    this.heatMaxTemp = parseInt(config.heatMaxTemp) || 30;
    this.heatMinTemp = parseInt(config.heatMinTemp) || 17;
    this.coolMaxTemp = parseInt(config.coolMaxTemp) || 30;
    this.coolMinTemp = parseInt(config.coolMinTemp) || 17;
    this.outerSensor = config.sensorSid;
    this.needSync = config.sync;
    if (config.customize) {
        this.customi = config.customize;
        this.log.debug("[XiaoMiAcPartner][DEBUG]Using customized AC signal...");
    }else{
        this.data = JSON;
        this.log.debug("[XiaoMiAcPartner][DEBUG]Using presets...");
    }
    
    this.services = [];

    //Register as Thermostat
    this.AcPartnerService = new Service.HeaterCooler(this.name);

    this.AcPartnerService
        .getCharacteristic(Characteristic.Active)
        .on('set', this.setActiveState.bind(this))
        .on('get', this.getActiveState.bind(this));

    this.AcPartnerService
        .getCharacteristic(Characteristic.CurrentHeaterCoolerState)
        .on('get', this.getCurrentHeaterCoolerState.bind(this));

    this.AcPartnerService
        .getCharacteristic(Characteristic.TargetHeaterCoolerState)
        .on('set', this.setTargetHeaterCoolerState.bind(this))
        .on('get', this.getTargetHeaterCoolerState.bind(this));

    this.AcPartnerService
        .getCharacteristic(Characteristic.CoolingThresholdTemperature)
        .setProps({
            maxValue: that.coolMaxTemp,
            minValue: that.coolMinTemp,
            minStep: 1
        })
        .on('set', this.setCoolingThresholdTemperature.bind(this))
        .on('get', this.getCoolingThresholdTemperature.bind(this));

    this.AcPartnerService
        .getCharacteristic(Characteristic.HeatingThresholdTemperature)
        .setProps({
            maxValue: that.heatMaxTemp,
            minValue: that.heatMinTemp,
            minStep: 1
        })
        .on('set', this.setHeatingThresholdTemperature.bind(this))
        .on('get', this.getHeatingThresholdTemperature.bind(this));

    this.AcPartnerService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({
            maxValue: 60,
            minValue: -20,
            minStep: 1
        })
        .on('get', this.getCurrentTemperature.bind(this));;

    this.AcPartnerService
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .setProps({
            maxValue: 100,
            minValue: 0,
            minStep: 1
        })
        .on('get', this.getCurrentRelativeHumidity.bind(this));

    this.AcPartnerService
        .getCharacteristic(Characteristic.SwingMode)
        .on('set', this.setSwingMode.bind(this))
        .on('get', this.getSwingMode.bind(this));

    this.AcPartnerService
        .getCharacteristic(Characteristic.RotationSpeed)
        .setProps({
            maxValue: 4,
            minValue: 1,
            minStep: 1
        })
        .on('get', this.getRotationSpeed.bind(this))
        .on('set', this.setRotationSpeed.bind(this));

    this.services.push(this.AcPartnerService);

    this.serviceInfo = new Service.AccessoryInformation();

    this.serviceInfo
        .setCharacteristic(Characteristic.Manufacturer, 'XiaoMi')
        .setCharacteristic(Characteristic.Model, 'AC Partner');
    
    this.services.push(this.serviceInfo);

    this.discover();

    this.doRestThing();

}

XiaoMiAcPartner.prototype = {
    doRestThing: function(){
        var that = this;
        this.CoolingThresholdTemperature = this.coolMaxTemp;
        this.HeatingThresholdTemperature = this.heatMinTemp;

        setInterval(function() {
            //Rediscover Partner every 180s
            that.discover();
        }, 180000);

        if (!this.needSync) {
            this.log.info("[XiaoMiAcPartner][INFO]Auto sync every 60 second");
            setInterval(function() {
                that.getPartnerState();
            }, 60000);   
        }else{
            this.log.info("[XiaoMiAcPartner][INFO]Auto sync off");
        }
    },

    discover: function(){
        var that = this;
        this.log.debug('[XiaoMiAcPartner][DEBUG]Searching AC Partner...');
        // Discover device in the network

        miio.device({ address: this.ip, token: this.token })
            .then(function(device){
                that.device = device;
                that.log.debug('[XiaoMiAcPartner][DEBUG]Discovered "%s" (ID: %s) on %s:%s.', device.hostname, device.id, device.address, device.port);
                if (!that.needSync) {
                    that.getPartnerState();   
                }
            }).catch(function(err){
                that.log.error("[XiaoMiAcPartner][ERROR]Cannot connect to AC Partner. " + err);
            })
    },

    getActiveState: function(callback){
        callback(null, this.ActiveState);
    },

    setActiveState: function(Active, callback, context){
        if (context !== 'fromSetValue') {
            this.ActiveState = Active;
            this.log.debug("[XiaoMiAcPartner][DEBUG]Set ActiveState: " + Active);
            //this.sendCode();
        }
    },

    getCurrentHeaterCoolerState: function(callback){
        callback(null, this.CurrentHeaterCoolerState);
    },

    getCoolingThresholdTemperature: function(callback){
        callback(null, this.CoolingThresholdTemperature);
    },

    setCoolingThresholdTemperature: function(CoolingThresholdTemperature, callback, context){
        if (context !== 'fromSetValue') {
            this.CoolingThresholdTemperature = CoolingThresholdTemperature;

            if (!this.outerSensor) {
                //Update CurrentTemp
            }
            this.log.debug("[XiaoMiAcPartner][DEBUG]Set CoolingThresholdTemperature: " + CoolingThresholdTemperature);
            //this.send_cmd();
        }
        callback();
    },

    getHeatingThresholdTemperature: function(callback){
        callback(null, this.HeatingThresholdTemperature);
    },

    setHeatingThresholdTemperature: function(HeatingThresholdTemperature, callback, context){
        if (context !== 'fromSetValue') {
            this.HeatingThresholdTemperature = HeatingThresholdTemperature;

            if (!this.outerSensor) {
                //Update CurrentTemp
            }
            this.log.debug("[XiaoMiAcPartner][DEBUG]Set HeatingThresholdTemperature: " + HeatingThresholdTemperature);
            //this.send_cmd();
        }
        callback();
    },

    setTargetHeaterCoolerState: function(TargetHeaterCoolerState, callback, context){
        if (context !== 'fromSetValue') {
            this.TargetHeaterCoolerState = TargetHeaterCoolerState;
            this.log.debug("[XiaoMiAcPartner][DEBUG]Set TargetHeaterCoolerState: " + TargetHeaterCoolerState);
            //this.sendCmd();
        }
        callback();
    },

    getTargetHeaterCoolerState: function(callback){
        callback(null, this.TargetHeaterCoolerState);
    },


    getCurrentTemperature: function(callback) {
        if (!this.outerSensor) {
            //Use TargetTemperature
            if (this.TargetHeaterCoolerState == Characteristic.TargetHeaterCoolerState.HEAT) {
                callback(null, parseFloat(this.HeatingThresholdTemperature));   
            }else{
                callback(null, parseFloat(this.CoolingThresholdTemperature));
            }
        }else{
            callback(null, parseFloat(this.CurrentTemperature));
        }
    },

    getCurrentRelativeHumidity: function(callback){
        callback(null, parseFloat(this.CurrentRelativeHumidity));
    },

    setSwingMode: function(SwingMode, callback, context){
        if (context !== 'fromSetValue') {
            this.SwingMode = SwingMode;
            this.log.debug("[XiaoMiAcPartner][DEBUG]Set SwingMode: " + SwingMode);
            //this.sendCmd();
        }
        callback();
    },

    getSwingMode: function(callback){
        callback(null, this.SwingMode);
    },

    setRotationSpeed: function(RotationSpeed, callback, context){
        if (context !== 'fromSetValue') {
            this.RotationSpeed = RotationSpeed;
            this.log.debug("[XiaoMiAcPartner][DEBUG]Set RotationSpeed: " + RotationSpeed);
            //this.sendCmd();
        }
        callback();
    },

    getRotationSpeed: function(callback){
        callback(null, this.RotationSpeed);
    },

    identify: function(callback) {
        callback();
    },

    getServices: function() {
        return this.services;
    },

    //Method:send_cmd, send_ir_code
    sendCode: function(method, code){
        if (!this.device) {
            this.log.error("[XiaoMiAcPartner][ERROR]Partner not connected, send code fail.");
            return;
        }
        var that = this;

        this.log.debug("[XiaoMiAcPartner][DEBUG]Sending Code: " + code);
        this.device.call(method, [code])
            .then(function(ret){
                that.log.debug("[XiaoMiAcPartner][DEBUG]Return result: " + ret);
            }).catch(function(err){
                that.log.error("[XiaoMiAcPartner][ERROR]Send code fail! " + err);
            });
    },

    getCode: function(){
        var code;
        if (!this.customi) {
            this.data.model = this.AcModel;
            this.data.ActiveState = this.Active;
            this.data.TargetHeaterCoolerState = this.TargetHeaterCoolerState;
            var retCode = outputSignal(this.data);
            if (!retCode) {
                this.log.error('[XiaoMiAcPartner][ERROR]Cannot get command code.')
                return;
            }
            //this.log.debug("[XiaoMiAcPartner][DEBUG] Get code: " + retCode.data);
            if (retCode.auto) {
                this.log.info('[XiaoMiAcPartner][INFO]You are using auto generate code, if your AC not response, please use customize method to control your AC.')
            }else{
                this.log.debug('[XiaoMiAcPartner][INFO]Using preset: %s',retCode.model);
            }
            code = retCode.data;
            delete retCode;

        }else{
            
        }
    },

    getCuSignal: function(){
        this.onStart();
        var code;
        if (this.TargetHeatingCoolingState != Characteristic.TargetHeatingCoolingState.OFF) {
            if (this.TargetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.HEAT) {
                if (!this.customi||!this.customi.heat||!this.customi.heat[this.TargetTemperature]) {
                    this.log.error('[XiaoMiAcPartner][ERROR]Current HEAT Signal not define!');
                    return;
                }
                code = this.customi.heat[this.TargetTemperature];
            }else if (this.TargetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.COOL){
                if (!this.customi||!this.customi.cool||!this.customi.cool[this.TargetTemperature]) {
                    this.log.error('[XiaoMiAcPartner][ERROR]COOL Signal not define!');
                    return;
                }
                code = this.customi.cool[this.TargetTemperature];
            }else{
                if (!this.customi||!this.customi.auto) {
                    this.log.error('[XiaoMiAcPartner][ERROR]AUTO Signal not define! Will send COOL signal instead');
                    if (!this.customi||!this.customi.cool||!this.customi.cool[this.TargetTemperature]) {
                        this.log.error('[XiaoMiAcPartner][ERROR]COOL Signal not define!');
                        return;
                    }
                    code = this.customi.cool[this.TargetTemperature];
                }else{
                    code = this.customi.auto;
                }
            }
        }else{
            if (!this.customi||!this.customi.off) {
                this.log.error('[XiaoMiAcPartner][ERROR]OFF Signal not define!');
                return;
            }
            code = this.customi.off;
        }
        return code;
    },

    SendCmd: function() {
        if (!this.device) {
            this.log.error('[XiaoMiAcPartner][ERROR]Device not exists, Send code failed!');
            return;
        }

        var accessory = this;
        var code;
        this.log.debug("[XiaoMiAcPartner][DEBUG]Last TargetHeatingCoolingState: " + this.LastHeatingCoolingState);
        this.log.debug("[XiaoMiAcPartner][DEBUG]Current TargetHeatingCoolingState: " + this.TargetHeatingCoolingState);
        if (!this.customi) {
            this.data.model = this.AcModel;
            this.data.TargetTemperature = this.TargetTemperature;
            this.data.TargetHeatingCoolingState = this.TargetHeatingCoolingState;
            this.data.LastHeatingCoolingState = this.LastHeatingCoolingState;
            var retCode = outputSignal(this.data);
            if (!retCode) {
                this.log.error('[XiaoMiAcPartner][ERROR]Cannot get command code.')
                return;
            }
            //this.log.debug("[XiaoMiAcPartner][DEBUG] Get code: " + retCode.data);
            if (retCode.auto) {
                this.log.info('[XiaoMiAcPartner][INFO]You are using auto_gen code, if your AC don\'t response, please use customize method to control your AC.')
            }else{
                this.log.debug('[XiaoMiAcPartner][INFO]Using preset: %s',retCode.model);
            }
            code = retCode.data;
            delete retCode;

        }else{
            code = this.getCuSignal();
            if (!code) {
                return;
            }
        }
        
        if (code.substr(0,2) == "01") {
            this.log.debug("[XiaoMiAcPartner][DEBUG]Sending AC code: " + code);
            this.device.call('send_cmd', [code])
                .then(function(data){
                    if (data[0] == "ok") {
                        accessory.LastHeatingCoolingState = accessory.TargetHeatingCoolingState;
                        accessory.log.debug("[XiaoMiAcPartner][DEBUG]Change Successful");
                    }else{
                        accessory.log.debug("[XiaoMiAcPartner][DEBUG]Unsuccess! Maybe invaild AC Code?");
                        accessory.getPartnerState();
                    }
                }).catch(function(err){
                    that.log.error("[XiaoMiAcPartner][ERROR]Send code fail! Error: " + err);
                });
        }else{
            this.log.debug("[XiaoMiAcPartner][DEBUG]Sending IR code: " + code);
            this.device.call('send_ir_code', [code])
                .then(function(data){
                    if (data[0] == "ok") {
                        accessory.LastHeatingCoolingState = accessory.TargetHeatingCoolingState;
                        accessory.log.debug("[XiaoMiAcPartner][DEBUG]Send Successful");
                    }else{
                        accessory.log.debug("[XiaoMiAcPartner][DEBUG]Unsuccess! Maybe invaild IR Code?");
                        accessory.getPartnerState();
                    }
                }).catch(function(err){
                        accessory.log.error("[XiaoMiAcPartner][ERROR]Send IR code fail! Error: " + err);
                });
        }
    },

    getPartnerState: function(){
        if (!this.device) {
            this.log.error("[XiaoMiAcPartner][ERROR]Sync failed!(Device not exists)");
            return;
        }

        var acc = this;
        this.log.debug("[XiaoMiAcPartner][INFO]Syncing...")

        //Update CurrentTemperature
        if(this.outerSensor){
            this.device.call('get_device_prop_exp', [[acc.outerSensor, "temperature", "humidity"]])
                .then(function(curTep){
                    if (curTep[0][0] == null) {
                        acc.log.error("[XiaoMiAcPartner][ERROR]Invaild sensorSid!")
                    }else{
                        acc.log.debug("[XiaoMiAcPartner][INFO]Temperature Sensor return:%s",curTep[0]);
                        acc.CurrentTemperature = curTep[0][0] / 100.0;
                        acc.CurrentRelativeHumidity = curTep[0][1] / 100.0;
                        acc.acPartnerService.getCharacteristic(Characteristic.CurrentTemperature)
                            .updateValue(acc.CurrentTemperature);
                        acc.acPartnerService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                            .updateValue(acc.CurrentRelativeHumidity);
                    }
                })
        }

        //Update AC state
        this.device.call('get_model_and_state', [])
            .then(function(retMaS){
                //acc.log(retMaS);
                acc.AcPower = retMaS[2];
                acc.AcModel = retMaS[0].substr(0,2) + retMaS[0].substr(8,8);
                var power = retMaS[1].substr(2,1);
                var mode = retMaS[1].substr(3,1);
                var wind_force = retMaS[1].substr(4,1);
                var swing = retMaS[1].substr(5,1);
                var temp = parseInt(retMaS[1].substr(6,2),16);
                acc.log.debug("[XiaoMiAcPartner][DEBUG]Partner_State:(model:%s, power_state:%s, mode:%s, wind:%s, swing:%s, temp:%s, AC_POWER:%s)",acc.AcModel,power,mode,wind_force,swing,temp,acc.AcPower);

                //Updata values
                acc.RotationSpeed = wind_force + 1;
                acc.SwingMode = ~swing;
                if (power == 1) {
                    acc.ActiveState = Characteristic.Active.ACTIVE;
                    if (mode == 0) {
                        acc.TargetHeaterCoolerState = acc.CurrentHeaterCoolerState = Characteristic.TargetHeaterCoolerState.HEAT;
                        if (temp <= acc.heatMaxTemp && temp >= acc.heatMinTemp) {
                            acc.HeatingThresholdTemperature = temp;
                        }else{
                            acc.HeatingThresholdTemperature = acc.heatMaxTemp;
                        }
                    }else if (mode == 1){
                        acc.TargetHeaterCoolerState = acc.CurrentHeaterCoolerState = Characteristic.TargetHeaterCoolerState.COOL;
                        if (temp <= acc.coolMaxTemp && temp >= acc.coolMinTemp) {
                            acc.CoolingThresholdTemperature = temp;
                        }else{
                            acc.CoolingThresholdTemperature = acc.coolMaxTemp;
                        }
                    }else{
                        acc.TargetHeaterCoolerState = Characteristic.TargetHeaterCoolerState.AUTO;
                        if (this.CurrentTemperature >= this.CoolingThresholdTemperature) {
                            acc.CurrentHeaterCoolerState = Characteristic.CurrentHeaterCoolerState.COOL;
                        }else if(this.CurrentTemperature < this.HeatingThresholdTemperature){
                            acc.CurrentHeaterCoolerState = Characteristic.CurrentHeaterCoolerState.HEAT;
                        }else{
                            acc.CurrentHeaterCoolerState = Characteristic.CurrentHeaterCoolerState.IDLE;
                        }
                    }
                }else{
                    acc.ActiveState = Characteristic.Active.INACTIVE;
                }
                if (acc.HeatingThresholdTemperature > acc.CoolingThresholdTemperature) {
                    acc.HeatingThresholdTemperature = acc.CoolingThresholdTemperature;
                }
                acc.AcPartnerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
                    .updateValue(acc.CurrentHeaterCoolerState);
                acc.AcPartnerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
                    .updateValue(acc.TargetHeaterCoolerState);
                acc.AcPartnerService.getCharacteristic(Characteristic.Active)
                    .updateValue(acc.ActiveState);
                acc.AcPartnerService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
                    .updateValue(acc.CoolingThresholdTemperature);
                acc.AcPartnerService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
                    .updateValue(acc.HeatingThresholdTemperature);
                acc.AcPartnerService.getCharacteristic(Characteristic.SwingMode)
                    .updateValue(acc.SwingMode);
                acc.AcPartnerService.getCharacteristic(Characteristic.RotationSpeed)
                    .updateValue(acc.RotationSpeed);

                acc.log.debug("[XiaoMiAcPartner][INFO]Sync complete")
            }).catch(function(err){
                acc.log.error("[XiaoMiAcPartner][ERROR]Sync fail! " + err);
            });
    }
};
