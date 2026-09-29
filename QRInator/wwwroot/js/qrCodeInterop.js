// QRCode for JavaScript
// Original: Copyright (c) 2009 Kazuhiko Arase
// License: MIT - http://www.opensource.org/licenses/mit-license.php
// Bundled and adapted for browser ES module use by QRInator.

// ── QRMath ──────────────────────────────────────────────────────────────────
const QRMath = (() => {
    const EXP_TABLE = new Array(256);
    const LOG_TABLE = new Array(256);
    for (let i = 0; i < 8; i++) EXP_TABLE[i] = 1 << i;
    for (let i = 8; i < 256; i++)
        EXP_TABLE[i] = EXP_TABLE[i-4] ^ EXP_TABLE[i-5] ^ EXP_TABLE[i-6] ^ EXP_TABLE[i-8];
    for (let i = 0; i < 255; i++) LOG_TABLE[EXP_TABLE[i]] = i;
    return {
        glog(n) { if (n < 1) throw new Error('glog(' + n + ')'); return LOG_TABLE[n]; },
        gexp(n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP_TABLE[n]; }
    };
})();

// ── QRPolynomial ────────────────────────────────────────────────────────────
class QRPolynomial {
    constructor(num, shift) {
        let offset = 0;
        while (offset < num.length && num[offset] === 0) offset++;
        this.num = new Array(num.length - offset + shift);
        for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
    }
    get(i) { return this.num[i]; }
    getLength() { return this.num.length; }
    multiply(e) {
        const num = new Array(this.getLength() + e.getLength() - 1);
        for (let i = 0; i < this.getLength(); i++)
            for (let j = 0; j < e.getLength(); j++)
                num[i+j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
        return new QRPolynomial(num, 0);
    }
    mod(e) {
        if (this.getLength() - e.getLength() < 0) return this;
        const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
        const num = this.num.slice();
        for (let x = 0; x < e.getLength(); x++)
            num[x] ^= QRMath.gexp(QRMath.glog(e.get(x)) + ratio);
        return new QRPolynomial(num, 0).mod(e);
    }
}

// ── QRMaskPattern / QRMode / QRErrorCorrectLevel ────────────────────────────
const QRMaskPattern = { PATTERN000:0, PATTERN001:1, PATTERN010:2, PATTERN011:3,
    PATTERN100:4, PATTERN101:5, PATTERN110:6, PATTERN111:7 };
const QRMode = { MODE_NUMBER:1, MODE_ALPHA_NUM:2, MODE_8BIT_BYTE:4, MODE_KANJI:8 };
const QRErrorCorrectLevel = { L:1, M:0, Q:3, H:2 };

// ── QRUtil ──────────────────────────────────────────────────────────────────
const QRUtil = (() => {
    const PATTERN_POSITION_TABLE = [
        [], [6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],
        [6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],
        [6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],
        [6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],
        [6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],
        [6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],
        [6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],
        [6,26,54,82,110,138,166],[6,30,58,86,114,142,170]
    ];
    const G15 = (1<<10)|(1<<8)|(1<<5)|(1<<4)|(1<<2)|(1<<1)|(1<<0);
    const G18 = (1<<12)|(1<<11)|(1<<10)|(1<<9)|(1<<8)|(1<<5)|(1<<2)|(1<<0);
    const G15_MASK = (1<<14)|(1<<12)|(1<<10)|(1<<4)|(1<<1);
    function getBCHDigit(d) { let digit=0; while(d!==0){digit++;d>>>=1;} return digit; }
    return {
        getPatternPosition: t => PATTERN_POSITION_TABLE[t-1],
        getBCHTypeInfo(data) {
            let d = data << 10;
            while (getBCHDigit(d) - getBCHDigit(G15) >= 0)
                d ^= G15 << (getBCHDigit(d) - getBCHDigit(G15));
            return ((data << 10) | d) ^ G15_MASK;
        },
        getBCHTypeNumber(data) {
            let d = data << 12;
            while (getBCHDigit(d) - getBCHDigit(G18) >= 0)
                d ^= G18 << (getBCHDigit(d) - getBCHDigit(G18));
            return (data << 12) | d;
        },
        getMask(pattern, i, j) {
            switch (pattern) {
                case 0: return (i+j)%2===0;
                case 1: return i%2===0;
                case 2: return j%3===0;
                case 3: return (i+j)%3===0;
                case 4: return (Math.floor(i/2)+Math.floor(j/3))%2===0;
                case 5: return (i*j)%2+(i*j)%3===0;
                case 6: return ((i*j)%2+(i*j)%3)%2===0;
                case 7: return ((i*j)%3+(i+j)%2)%2===0;
                default: throw new Error('bad maskPattern:'+pattern);
            }
        },
        getErrorCorrectPolynomial(len) {
            let a = new QRPolynomial([1], 0);
            for (let i = 0; i < len; i++)
                a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
            return a;
        },
        getLengthInBits(mode, type) {
            if (type < 10) {
                if (mode===QRMode.MODE_NUMBER) return 10;
                if (mode===QRMode.MODE_ALPHA_NUM) return 9;
                if (mode===QRMode.MODE_8BIT_BYTE) return 8;
                if (mode===QRMode.MODE_KANJI) return 8;
            } else if (type < 27) {
                if (mode===QRMode.MODE_NUMBER) return 12;
                if (mode===QRMode.MODE_ALPHA_NUM) return 11;
                if (mode===QRMode.MODE_8BIT_BYTE) return 16;
                if (mode===QRMode.MODE_KANJI) return 10;
            } else {
                if (mode===QRMode.MODE_NUMBER) return 14;
                if (mode===QRMode.MODE_ALPHA_NUM) return 13;
                if (mode===QRMode.MODE_8BIT_BYTE) return 16;
                if (mode===QRMode.MODE_KANJI) return 12;
            }
            throw new Error('mode:'+mode);
        },
        getLostPoint(qr) {
            const n = qr.getModuleCount();
            let lost = 0;
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    let same = 0;
                    const dark = qr.isDark(r,c);
                    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                        if ((dr===0&&dc===0)||r+dr<0||r+dr>=n||c+dc<0||c+dc>=n) continue;
                        if (dark===qr.isDark(r+dr,c+dc)) same++;
                    }
                    if (same > 5) lost += 3+same-5;
                }
            }
            for (let r = 0; r < n-1; r++) for (let c = 0; c < n-1; c++) {
                let cnt=0;
                if(qr.isDark(r,c))cnt++;if(qr.isDark(r+1,c))cnt++;
                if(qr.isDark(r,c+1))cnt++;if(qr.isDark(r+1,c+1))cnt++;
                if(cnt===0||cnt===4) lost+=3;
            }
            for (let r = 0; r < n; r++) for (let c = 0; c < n-6; c++)
                if(qr.isDark(r,c)&&!qr.isDark(r,c+1)&&qr.isDark(r,c+2)&&qr.isDark(r,c+3)&&qr.isDark(r,c+4)&&!qr.isDark(r,c+5)&&qr.isDark(r,c+6)) lost+=40;
            for (let c = 0; c < n; c++) for (let r = 0; r < n-6; r++)
                if(qr.isDark(r,c)&&!qr.isDark(r+1,c)&&qr.isDark(r+2,c)&&qr.isDark(r+3,c)&&qr.isDark(r+4,c)&&!qr.isDark(r+5,c)&&qr.isDark(r+6,c)) lost+=40;
            let darkCount=0;
            for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(qr.isDark(r,c)) darkCount++;
            lost += Math.abs(100*darkCount/n/n-50)/5*10;
            return lost;
        }
    };
})();

// ── QRRSBlock ────────────────────────────────────────────────────────────────
const QRRSBlock = (() => {
    const RS_BLOCK_TABLE = [
        [1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],
        [1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],
        [1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],
        [2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],
        [2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],
        [4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],
        [4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],
        [5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],
        [1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],
        [3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],
        [4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],
        [4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],
        [8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],
        [8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],
        [7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],
        [13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],
        [17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],
        [12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],
        [17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],
        [20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]
    ];
    return {
        getRSBlocks(typeNumber, errorCorrectLevel) {
            const tbl = RS_BLOCK_TABLE[(typeNumber-1)*4 + [1,0,3,2][errorCorrectLevel] ];
            const len = tbl.length/3;
            const list = [];
            for (let i=0;i<len;i++) for(let j=0;j<tbl[i*3];j++) list.push({totalCount:tbl[i*3+1],dataCount:tbl[i*3+2]});
            return list;
        }
    };
})();

// ── QRBitBuffer ──────────────────────────────────────────────────────────────
class QRBitBuffer {
    constructor() { this.buffer=[]; this.length=0; }
    put(num,len) { for(let i=0;i<len;i++) this.putBit(((num>>>(len-i-1))&1)===1); }
    getLengthInBits() { return this.length; }
    putBit(bit) {
        const idx = Math.floor(this.length/8);
        if (this.buffer.length<=idx) this.buffer.push(0);
        if (bit) this.buffer[idx] |= 0x80>>>(this.length%8);
        this.length++;
    }
}

// ── QRCode ───────────────────────────────────────────────────────────────────
class QRCode {
    constructor(typeNumber, errorCorrectLevel) {
        this.typeNumber = typeNumber;
        this.errorCorrectLevel = errorCorrectLevel;
        this.modules = null;
        this.moduleCount = 0;
        this.dataCache = null;
        this.dataList = [];
    }
    addData(data) {
        // Encode data as UTF-8 bytes for correct multi-byte character support
        const encoded = new TextEncoder().encode(data);
        this.dataList.push({ mode: QRMode.MODE_8BIT_BYTE, data: encoded,
            getLength() { return this.data.length; },
            write(buf) { for (const b of this.data) buf.put(b, 8); }
        });
        this.dataCache = null;
    }
    isDark(row,col) { return this.modules[row][col]; }
    getModuleCount() { return this.moduleCount; }
    make() {
        if (this.typeNumber < 1) {
            for (let v=1;v<40;v++) {
                const rsBlocks = QRRSBlock.getRSBlocks(v, this.errorCorrectLevel);
                const buf = new QRBitBuffer();
                let total=0; for(const b of rsBlocks) total+=b.dataCount;
                for(const d of this.dataList) { buf.put(d.mode,4); buf.put(d.getLength(),QRUtil.getLengthInBits(d.mode,v)); d.write(buf); }
                if(buf.getLengthInBits()<=total*8){this.typeNumber=v;break;}
            }
        }
        this._makeImpl(false, this._getBestMaskPattern());
    }
    _makeImpl(test, maskPattern) {
        this.moduleCount = this.typeNumber*4+17;
        this.modules = Array.from({length:this.moduleCount},()=>new Array(this.moduleCount).fill(null));
        this._setupPositionProbePattern(0,0);
        this._setupPositionProbePattern(this.moduleCount-7,0);
        this._setupPositionProbePattern(0,this.moduleCount-7);
        this._setupPositionAdjustPattern();
        this._setupTimingPattern();
        this._setupTypeInfo(test,maskPattern);
        if(this.typeNumber>=7) this._setupTypeNumber(test);
        if(!this.dataCache) this.dataCache=QRCode._createData(this.typeNumber,this.errorCorrectLevel,this.dataList);
        this._mapData(this.dataCache,maskPattern);
    }
    _getBestMaskPattern() {
        let minLost=0,pattern=0;
        for(let i=0;i<8;i++){this._makeImpl(true,i);const l=QRUtil.getLostPoint(this);if(i===0||l<minLost){minLost=l;pattern=i;}}
        return pattern;
    }
    _setupPositionProbePattern(row,col) {
        for(let r=-1;r<=7;r++) for(let c=-1;c<=7;c++){
            if(row+r<0||row+r>=this.moduleCount||col+c<0||col+c>=this.moduleCount) continue;
            this.modules[row+r][col+c]=((0<=r&&r<=6&&(c===0||c===6))||(0<=c&&c<=6&&(r===0||r===6))||(2<=r&&r<=4&&2<=c&&c<=4));
        }
    }
    _setupPositionAdjustPattern() {
        const pos=QRUtil.getPatternPosition(this.typeNumber);
        for(const pr of pos) for(const pc of pos){
            if(this.modules[pr][pc]!==null) continue;
            for(let r=-2;r<=2;r++) for(let c=-2;c<=2;c++)
                this.modules[pr+r][pc+c]=(Math.abs(r)===2||Math.abs(c)===2||(r===0&&c===0));
        }
    }
    _setupTimingPattern() {
        for(let i=8;i<this.moduleCount-8;i++){
            if(this.modules[i][6]===null) this.modules[i][6]=(i%2===0);
            if(this.modules[6][i]===null) this.modules[6][i]=(i%2===0);
        }
    }
    _setupTypeNumber(test) {
        const bits=QRUtil.getBCHTypeNumber(this.typeNumber);
        for(let i=0;i<18;i++){
            const mod=!test&&((bits>>i)&1)===1;
            this.modules[Math.floor(i/3)][i%3+this.moduleCount-8-3]=mod;
        }
        for(let i=0;i<18;i++){
            const mod=!test&&((bits>>i)&1)===1;
            this.modules[i%3+this.moduleCount-8-3][Math.floor(i/3)]=mod;
        }
    }
    _setupTypeInfo(test,maskPattern) {
        const data=(this.errorCorrectLevel<<3)|maskPattern;
        const bits=QRUtil.getBCHTypeInfo(data);
        for(let v=0;v<15;v++){
            const mod=!test&&((bits>>v)&1)===1;
            if(v<6) this.modules[v][8]=mod;
            else if(v<8) this.modules[v+1][8]=mod;
            else this.modules[this.moduleCount-15+v][8]=mod;
        }
        for(let h=0;h<15;h++){
            const mod=!test&&((bits>>h)&1)===1;
            if(h<8) this.modules[8][this.moduleCount-h-1]=mod;
            else if(h<9) this.modules[8][15-h-1+1]=mod;
            else this.modules[8][15-h-1]=mod;
        }
        this.modules[this.moduleCount-8][8]=!test;
    }
    _mapData(data,maskPattern) {
        let inc=-1,row=this.moduleCount-1,bitIndex=7,byteIndex=0;
        for(let col=this.moduleCount-1;col>0;col-=2){
            if(col===6) col--;
            while(true){
                for(let c=0;c<2;c++){
                    if(this.modules[row][col-c]===null){
                        let dark=byteIndex<data.length&&((data[byteIndex]>>>bitIndex)&1)===1;
                        if(QRUtil.getMask(maskPattern,row,col-c)) dark=!dark;
                        this.modules[row][col-c]=dark;
                        if(--bitIndex===-1){byteIndex++;bitIndex=7;}
                    }
                }
                row+=inc;
                if(row<0||row>=this.moduleCount){row-=inc;inc=-inc;break;}
            }
        }
    }
    static _createData(typeNumber,errorCorrectLevel,dataList) {
        const rsBlocks=QRRSBlock.getRSBlocks(typeNumber,errorCorrectLevel);
        const buf=new QRBitBuffer();
        let totalDataCount=0;
        for(const b of rsBlocks) totalDataCount+=b.dataCount;
        for(const d of dataList){ buf.put(d.mode,4); buf.put(d.getLength(),QRUtil.getLengthInBits(d.mode,typeNumber)); d.write(buf); }
        if(buf.getLengthInBits()>totalDataCount*8) throw new Error('overflow');
        if(buf.getLengthInBits()+4<=totalDataCount*8) buf.put(0,4);
        while(buf.getLengthInBits()%8!==0) buf.putBit(false);
        while(buf.getLengthInBits()<totalDataCount*8){ buf.put(0xEC,8); if(buf.getLengthInBits()<totalDataCount*8) buf.put(0x11,8); }
        return QRCode._createBytes(buf,rsBlocks);
    }
    static _createBytes(buffer,rsBlocks) {
        let offset=0,maxDc=0,maxEc=0;
        const dcdata=[],ecdata=[];
        for(const block of rsBlocks){
            const dc=block.dataCount,ec=block.totalCount-dc;
            maxDc=Math.max(maxDc,dc); maxEc=Math.max(maxEc,ec);
            const dcd=buffer.buffer.slice(offset,offset+dc); offset+=dc;
            const rsPoly=QRUtil.getErrorCorrectPolynomial(ec);
            const rawPoly=new QRPolynomial(dcd,rsPoly.getLength()-1);
            const modPoly=rawPoly.mod(rsPoly);
            const ecd=new Array(rsPoly.getLength()-1);
            for(let x=0;x<ecd.length;x++){
                const mi=x+modPoly.getLength()-ecd.length;
                ecd[x]=mi>=0?modPoly.get(mi):0;
            }
            dcdata.push(dcd); ecdata.push(ecd);
        }
        const totalCount=rsBlocks.reduce((s,b)=>s+b.totalCount,0);
        const data=new Array(totalCount);
        let idx=0;
        for(let z=0;z<maxDc;z++) for(const dc of dcdata) if(z<dc.length) data[idx++]=dc[z];
        for(let z=0;z<maxEc;z++) for(const ec of ecdata) if(z<ec.length) data[idx++]=ec[z];
        return data;
    }
}

// ── Canvas rendering & interop exports ───────────────────────────────────────

/**
 * Generate a QR code and draw it on a canvas element.
 * @param {string} canvasId   - id of the <canvas> element
 * @param {string} text       - content to encode
 * @param {number} size       - canvas size in CSS pixels (square)
 * @param {string} darkColor  - foreground colour (CSS colour string, default '#000000')
 * @param {string} lightColor - background colour (CSS colour string, default '#ffffff')
 */
export function generateQR(canvasId, text, size, darkColor, lightColor) {
    if (!text || text.trim() === '') return;
    darkColor  = darkColor  || '#000000';
    lightColor = lightColor || '#ffffff';
    size       = size       || 300;

    const qr = new QRCode(-1, QRErrorCorrectLevel.M);
    qr.addData(text);
    qr.make();

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.width  = size;
    canvas.height = size;

    const ctx   = canvas.getContext('2d');
    const count = qr.getModuleCount();
    const quiet = Math.ceil(size * 0.04); // ~4% quiet zone on each side
    const cell  = (size - quiet * 2) / count;

    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = darkColor;

    for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
            if (qr.isDark(row, col)) {
                ctx.fillRect(
                    Math.floor(quiet + col * cell),
                    Math.floor(quiet + row * cell),
                    Math.ceil(cell),
                    Math.ceil(cell)
                );
            }
        }
    }
}

/**
 * Export the canvas contents as a high-resolution PNG download.
 * @param {string} canvasId - id of the source <canvas> element
 * @param {string} text     - content to encode (re-rendered at high res)
 * @param {number} exportSize - width/height of the exported PNG in pixels (default 1024)
 * @param {string} darkColor  - foreground colour
 * @param {string} lightColor - background colour
 * @param {string} filename   - download filename (default 'qrcode.png')
 */
export function downloadQR(canvasId, text, exportSize, darkColor, lightColor, filename) {
    if (!text || text.trim() === '') return;
    exportSize = exportSize || 1024;
    filename   = filename   || 'qrcode.png';
    darkColor  = darkColor  || '#000000';
    lightColor = lightColor || '#ffffff';

    // Render a fresh high-resolution off-screen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width  = exportSize;
    offscreen.height = exportSize;

    const qr = new QRCode(-1, QRErrorCorrectLevel.M);
    qr.addData(text);
    qr.make();

    const ctx   = offscreen.getContext('2d');
    const count = qr.getModuleCount();
    const quiet = Math.ceil(exportSize * 0.04);
    const cell  = (exportSize - quiet * 2) / count;

    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, exportSize, exportSize);
    ctx.fillStyle = darkColor;

    for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
            if (qr.isDark(row, col)) {
                ctx.fillRect(
                    Math.floor(quiet + col * cell),
                    Math.floor(quiet + row * cell),
                    Math.ceil(cell),
                    Math.ceil(cell)
                );
            }
        }
    }

    const link = document.createElement('a');
    link.download = filename;
    link.href = offscreen.toDataURL('image/png');
    link.click();
}
